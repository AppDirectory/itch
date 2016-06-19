
import ospath from 'path'
import invariant from 'invariant'

import {map, each, sortBy} from 'underline'
import Promise from 'bluebird'
import shellQuote from 'shell-quote'
import toml from 'toml'

import poker from './poker'

import {getT} from '../../localizer'

import {dialog} from '../../electron'

import store from '../../store'
import sandbox from '../../util/sandbox'
import os from '../../util/os'
import sf from '../../util/sf'
import spawn from '../../util/spawn'
import fetch from '../../util/fetch'
import pathmaker from '../../util/pathmaker'

import mklog from '../../util/log'
const log = mklog('tasks/launch')

import {Crash} from '../errors'

async function doSpawn (exePath, fullCommand, opts) {
  log(opts, `doSpawn ${fullCommand}`)

  const cwd = ospath.dirname(exePath)
  log(opts, `Working directory: ${cwd}`)

  const args = shellQuote.parse(fullCommand)
  const command = args.shift()
  log(opts, `Command: ${command}`)
  log(opts, `Args: ${args}`)

  const code = await spawn({
    command,
    args,
    onToken: (tok) => log(opts, `stdout: ${tok}`),
    onErrToken: (tok) => log(opts, `stderr: ${tok}`),
    opts: {cwd}
  })

  if (code !== 0) {
    const error = `process exited with code ${code}`
    throw new Crash({exePath, error})
  }
  return 'child completed successfully'
}

function isAppBundle (exePath) {
  return /\.app\/?$/.test(exePath.toLowerCase())
}

async function launchExecutable (exePath, args, opts) {
  const platform = os.platform()
  log(opts, `launching '${exePath}' on '${platform}' with args '${args.join(' ')}'`)
  const argString = args::map(spawn.escapePath).join(' ')

  const {cave} = opts
  const appPath = pathmaker.appPath(cave)

  const {isolateApps} = opts.preferences
  if (isolateApps) {
    const checkRes = await sandbox.check()
    if (checkRes.errors.length > 0) {
      throw new Error(`error(s) while checking for sandbox: ${checkRes.errors.join(', ')}`)
    }

    if (checkRes.needs.length > 0) {
      const installRes = await sandbox.install(opts, checkRes.needs)
      if (installRes.errors.length > 0) {
        throw new Error(`error(s) while installing sandbox: ${installRes.errors.join(', ')}`)
      }
    }
  }

  let fullExec = exePath
  if (platform === 'darwin') {
    const isBundle = isAppBundle(exePath)
    if (isBundle) {
      fullExec = await spawn.getOutput({
        command: 'activate',
        args: ['--print-bundle-executable-path', exePath],
        logger: opts.logger
      })
    }

    if (isolateApps) {
      log(opts, 'app isolation enabled')

      const sandboxOpts = {
        ...opts,
        appPath,
        exePath,
        fullExec,
        argString,
        isBundle
      }

      await sandbox.within(sandboxOpts, async function ({fakeApp}) {
        await doSpawn(fullExec, `open -W ${escape(fakeApp)}`, opts)
      })
    } else {
      log(opts, 'no app isolation')
      await doSpawn(fullExec, `open -W ${escape(exePath)} --args ${argString}`, opts)
    }
  } else if (platform === 'win32') {
    let cmd = `${escape(exePath)}`
    if (argString.length > 0) {
      cmd += ` ${argString}`
    }

    const grantPath = ospath.join(appPath, '*')
    if (isolateApps) {
      const grantRes = await spawn.getOutput({
        command: 'icacls',
        args: [ grantPath, '/grant', 'itch-player:F', '/t' ],
        logger: opts.logger
      })
      log(opts, `grant output:\n${grantRes}`)

      cmd = `elevate --runas itch-player salt ${cmd}`
    }
    await doSpawn(exePath, cmd, opts)

    if (isolateApps) {
      const denyRes = await spawn.getOutput({
        command: 'icacls',
        args: [ grantPath, '/deny', 'itch-player:F', '/t' ],
        logger: opts.logger
      })
      log(opts, `deny output:\n${denyRes}`)
    }
  } else if (platform === 'linux') {
    let cmd = `${escape(exePath)}`
    if (argString.length > 0) {
      cmd += ` ${argString}`
    }
    if (isolateApps) {
      log(opts, 'should write firejail profile file')

      cmd = `firejail --noprofile -- ${cmd}`
      await doSpawn(exePath, cmd, opts)
    } else {
      await doSpawn(exePath, cmd, opts)
    }
  } else {
    throw new Error(`unsupported platform: ${platform}`)
  }
}

export default async function launch (out, opts) {
  const {cave, market, credentials} = opts
  invariant(cave, 'launch-native has cave')
  log(opts, `launching cave in '${cave.installLocation}' / '${cave.installFolder}'`)

  const game = await fetch.gameLazily(market, credentials, cave.gameId)
  invariant(game, 'was able to fetch game properly')

  const appPath = pathmaker.appPath(cave)
  let exePath
  let args = []

  const manifestPath = ospath.join(appPath, '.itch.toml')
  const hasManifest = await sf.exists(manifestPath)
  if (hasManifest) {
    log(opts, `has manifest @ "${manifestPath}"`)

    let manifest
    try {
      const contents = await sf.readFile(manifestPath)
      manifest = toml.parse(contents)
    } catch (e) {
      log(opts, `error reading manifest: ${e}`)
      throw e
    }

    log(opts, `manifest:\n ${JSON.stringify(manifest, 0, 2)}`)

    const i18n = store.getState().i18n
    const t = getT(i18n.strings, i18n.lang)

    const buttons = []
    manifest.actions::each((action, i) => {
      if (!action.name) {
        throw new Error(`in manifest, action ${i} is missing a name`)
      }
      buttons.push(t(`action.name.${action.name}`, {defaultValue: action.name}))
    })

    const cancelId = buttons.length
    buttons.push(t('prompt.action.cancel'))

    const dialogOpts = {
      title: game.title,
      message: t('prompt.launch.message', {title: game.title}),
      buttons,
      cancelId
    }

    const promise = new Promise((resolve, reject) => {
      const callback = (response) => {
        resolve(response)
      }
      dialog.showMessageBox(dialogOpts, callback)
    })

    const response = await promise
    if (response === cancelId) {
      return
    }

    const action = manifest.actions[response]
    if (action) {
      log(opts, `Should launch ${JSON.stringify(action, 0, 2)}`)
      exePath = ospath.isAbsolute(action.path) ? action.path : ospath.join(appPath, action.path)
    } else {
      log(opts, `No action at ${response}`)
    }
  }

  if (!exePath) {
    const pokerOpts = {
      ...opts,
      appPath
    }
    exePath = await poker(pokerOpts)
  }

  if (!exePath) {
    const err = new Error(`No executables found (${hasManifest ? 'with' : 'without'} manifest)`)
    err.reason = ['game.install.no_executables_found']
    throw err
  }

  if (/\.jar$/i.test(exePath)) {
    log(opts, 'Launching .jar')
    args.push('-jar')
    args.push(exePath)
    exePath = 'java'
  }

  return await launchExecutable(exePath, args, opts)
}
