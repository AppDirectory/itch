import React from "react";
import { connect, actionCreatorsList, Dispatchers } from "./connect";

import { map } from "underscore";
import { createStructuredSelector } from "reselect";

import Filler from "./basics/filler";
import IconButton from "./basics/icon-button";
import Search from "./sidebar/search";
import Tab from "./sidebar/tab";
import Logo from "./sidebar/logo";

import { IRootState, IOpenTabs } from "common/types";

import { SortableContainer, arrayMove } from "react-sortable-hoc";

import styled, * as styles from "./styles";
import { SidebarSection, SidebarHeading } from "./sidebar/styles";

import { T } from "renderer/t";
import { User } from "common/butlerd/messages";
import { rendererNavigation, rendererWindow } from "common/util/navigation";

const SidebarDiv = styled.div`
  background: ${props => props.theme.sidebarBackground};
  font-size: ${styles.fontSizes.sidebar};

  height: 100%;
  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  align-items: stretch;
  flex-direction: column;
`;

const SidebarItems = styled.div`
  display: flex;
  align-items: stretch;
  flex-direction: column;

  overflow: hidden;
  flex-grow: 1;
`;

interface ISortEndParams {
  oldIndex: number;
  newIndex: number;
}

interface ISortableContainerParams {
  items: string[];
  sidebarProps: IProps & IDerivedProps;
}

const SortableListContainer = styled.div`
  overflow-y: auto;
`;

const SortableList = SortableContainer((params: ISortableContainerParams) => {
  const { sidebarProps, items } = params;
  const currentTab = sidebarProps.tab;

  return (
    <SortableListContainer>
      {map(items, (tab, index) => {
        const active = currentTab === tab;
        return (
          <Tab key={tab} tab={tab} active={active} index={index} sortable />
        );
      })}
    </SortableListContainer>
  );
});

class Sidebar extends React.PureComponent<IProps & IDerivedProps, IState> {
  constructor(props: Sidebar["props"], context) {
    super(props, context);
    this.state = {
      transient: props.openTabs.transient,
    };
  }

  closeAllTabs = () => {
    this.props.closeAllTabs({
      window: rendererWindow(),
    });
  };

  newTab = () => {
    this.props.newTab({
      window: rendererWindow(),
    });
  };

  onSortEnd = (params: ISortEndParams) => {
    const { oldIndex, newIndex } = params;
    this.setState({
      transient: arrayMove(this.state.transient, oldIndex, newIndex),
    });
    this.props.moveTab({
      window: rendererWindow(),
      before: oldIndex,
      after: newIndex,
    });
  };

  render() {
    const { sidebarWidth, tab: currentId, openTabs } = this.props;

    return (
      <SidebarDiv id="sidebar" style={{ width: `${sidebarWidth}px` }}>
        <Logo />

        <Search />

        <SidebarItems>
          <SidebarSection>
            <SidebarHeading>{T(["sidebar.category.basics"])}</SidebarHeading>
          </SidebarSection>

          {map(openTabs.constant, (id, index) => {
            return <Tab key={id} tab={id} active={currentId === id} />;
          })}

          <SidebarSection>
            <SidebarHeading>{T(["sidebar.category.tabs"])}</SidebarHeading>
            <Filler />
            <IconButton
              icon="delete"
              id="sidebar-close-all-tabs"
              hint={["sidebar.close_all_tabs"]}
              onClick={this.closeAllTabs}
            />
            <IconButton
              id="new-tab-icon"
              icon="plus"
              hint={["sidebar.new_tab"]}
              onClick={this.newTab}
            />
          </SidebarSection>

          <SortableList
            items={this.state.transient}
            sidebarProps={this.props}
            onSortEnd={this.onSortEnd}
            distance={5}
            lockAxis="y"
          />
        </SidebarItems>

        <Filler />
      </SidebarDiv>
    );
  }

  componentWillReceiveProps(props: IProps & IDerivedProps) {
    this.setState({
      transient: props.openTabs.transient,
    });
  }
}

interface IProps {}

const actionCreators = actionCreatorsList(
  "closeAllTabs",
  "moveTab",
  "newTab",
  "copyToClipboard",
  "reportIssue",
  "quit"
);

type IDerivedProps = Dispatchers<typeof actionCreators> & {
  sidebarWidth: number;
  me: User;

  tab: string;
  path: string;
  openTabs: IOpenTabs;
};

interface IState {
  transient: string[];
}

export default connect<IProps>(Sidebar, {
  state: createStructuredSelector({
    appVersion: (rs: IRootState) => rs.system.appVersion,
    sidebarWidth: (rs: IRootState) => rs.preferences.sidebarWidth || 240,
    me: (rs: IRootState) => rs.profile.credentials.me,
    tab: (rs: IRootState) => rendererNavigation(rs).tab,
    openTabs: (rs: IRootState) => rendererNavigation(rs).openTabs,
  }),
  actionCreators,
});