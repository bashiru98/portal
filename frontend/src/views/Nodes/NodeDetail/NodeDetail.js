import React, {Component} from "react";
import {Alert, Button, Col, Modal, Row} from "react-bootstrap";
import InfoCard from "../../../core/components/InfoCard/InfoCard";
import {STAKE_STATUS, TABLE_COLUMNS} from "../../../_constants";
import NetworkService from "../../../core/services/PocketNetworkService";
import Loader from "../../../core/components/Loader";
import {_getDashboardPath, DASHBOARD_PATHS} from "../../../_routes";
import DeletedOverlay from "../../../core/components/DeletedOverlay/DeletedOverlay";
import {formatNetworkData, formatNumbers, getStakeStatus,} from "../../../_helpers";
import {Link} from "react-router-dom";
import PocketUserService from "../../../core/services/PocketUserService";
import moment from "moment";
import AppTable from "../../../core/components/AppTable";
import AppAlert from "../../../core/components/AppAlert";
import ValidateKeys from "../../../core/components/ValidateKeys/ValidateKeys";
import Segment from "../../../core/components/Segment/Segment";
import NodeService from "../../../core/services/PocketNodeService";
import "../../../scss/Views/Detail.scss";

class NodeDetail extends Component {
  constructor(props, context) {
    super(props, context);

    this.state = {
      pocketNode: {},
      networkData: {},
      chains: [],
      aat: {},
      loading: true,
      deleteModal: false,
      deleted: false,
      message: "",
      purchase: true,
      hideTable: false,
      exists: true,
      unstake: false,
      stake: false,
      ctaButtonPressed: false,
    };

    this.deleteNode = this.deleteNode.bind(this);
    this.unstakeNode = this.unstakeNode.bind(this);
    this.stakeNode = this.stakeNode.bind(this);
    this.fetchData = this.fetchData.bind(this);
  }

  async componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    // eslint-disable-next-line react/prop-types
    const {address} = this.props.match.params;

    const {pocketNode, networkData} = await NodeService.getNode(address);

    if (pocketNode === undefined) {
      this.setState({loading: false, exists: false});
      return;
    }

    const chains = await NetworkService.getNetworkChains(networkData.chains);

    this.setState({
      pocketNode,
      networkData,
      chains,
      loading: false,
    });
  }

  async deleteNode() {
    const {address} = this.state.pocketNode.publicPocketAccount;

    const nodesLink = `${window.location.origin}${_getDashboardPath(
      DASHBOARD_PATHS.nodes
    )}`;
    const userEmail = PocketUserService.getUserInfo().email;

    const success = await NodeService.deleteNodeFromDashboard(
      address, userEmail, nodesLink
    );

    if (success) {
      this.setState({deleted: true});
    }
  }

  async unstakeNode({privateKey, passphrase, address}) {
    const url = _getDashboardPath(DASHBOARD_PATHS.nodeDetail);
    const detail = url.replace(":address", address);
    const link = `${window.location.origin}${detail}`;

    // FIXME: The firm of this method has been changed.
    const {success, data} = NodeService.unstakeNode(
      privateKey, passphrase, address, link
    );

    if (success) {
      // "Reload page" for updated networkData
      this.setState({loading: true, unstaking: false});
      this.fetchData();
    } else {
      this.setState({unstaking: false, message: data});
    }
  }

  async stakeNode({privateKey, passphrase, address}) {
    NodeService.removeNodeInfoFromCache();
    NodeService.saveNodeInfoInCache({address, privateKey, passphrase});

    // TODO: Use stakeNode method from PocketNodeService.

    // eslint-disable-next-line react/prop-types
    this.props.history.push(_getDashboardPath(DASHBOARD_PATHS.nodeChainList));
  }

  render() {
    const {
      name,
      url,
      contactEmail,
      operator,
      description,
      icon,
      jailed,
      publicPocketAccount,
    } = this.state.pocketNode;
    const {
      staked_tokens: stakedTokens,
      status: bondStatus,
      unstakingCompletionTime,
    } = this.state.networkData;
    const status = getStakeStatus(bondStatus);
    const isStaked =
      status !== STAKE_STATUS.Unstaked && status !== STAKE_STATUS.Unstaking;

    let address;
    let publicKey;

    if (publicPocketAccount) {
      address = publicPocketAccount.address;
      publicKey = publicPocketAccount.publicKey;
    }

    const {
      chains,
      loading,
      deleteModal,
      deleted,
      message,
      exists,
      unstake,
      stake,
      ctaButtonPressed,
    } = this.state;

    const generalInfo = [
      {
        title: `${formatNetworkData(stakedTokens)} POKT`,
        subtitle: "Staked tokens",
      },
      // TODO: Change this value.
      {
        title: `${formatNetworkData(20000)} POKT`,
        subtitle: "Balance",
      },
      {
        title: status,
        subtitle: "Stake Status",
        children:
          status === STAKE_STATUS.Unstaking ? (
            <p className="unstaking-time">{`Unstaking time: ${moment
              .duration({seconds: unstakingCompletionTime})
              .humanize()}`}</p>
          ) : undefined,
      },
      {title: jailed ? "YES" : "NO", subtitle: "Jailed"},
      // TODO: Get validator power
      {title: formatNumbers(10000), subtitle: "Validator Power"},
    ];

    const contactInfo = [
      // TODO: Get service URL
      {title: "Service URL", subtitle: url},
      {title: "Contact email", subtitle: contactEmail},
    ];

    const renderValidation = (handleFunc) => (
      <ValidateKeys address={address} handleAfterValidate={handleFunc}>
        <h1>Confirm private key</h1>
        <p>
          Import to the dashboard a pocket account previously created as a node
          in the network. If your account is not a node go to create.
        </p>
      </ValidateKeys>
    );

    if (ctaButtonPressed && stake) {
      return renderValidation(this.stakeNode);
    }

    if (ctaButtonPressed && unstake) {
      return renderValidation(this.unstakeNode);
    }

    if (loading) {
      return <Loader />;
    }

    if (!exists) {
      const message = (
        <h3>
          This Node does not exist.{" "}
          <Link to={_getDashboardPath(DASHBOARD_PATHS.nodes)}>
            Go to Node List
          </Link>
        </h3>
      );

      return <AppAlert variant="danger" title={message} />;
    }

    if (deleted) {
      return (
        <DeletedOverlay
          text={
            <p>
              Your node
              <br />
              was successfully removed
            </p>
          }
          buttonText="Go to Node List"
          buttonLink={_getDashboardPath(DASHBOARD_PATHS.nodes)}
        />
      );
    }

    return (
      <div className="detail">
        <Row>
          <Col>
            {message && (
              <AppAlert
                variant="danger"
                title={message}
                onClose={() => this.setState({message: ""})}
                dismissible
              />
            )}
            <div className="head">
              <img src={icon} alt="node-icon" />
              <div className="info">
                <h1 className="name d-flex align-items-center">{name}</h1>
                <h3 className="owner">{operator}</h3>
                <p className="description">{description}</p>
              </div>
            </div>
          </Col>
        </Row>
        <Row>
          <Col sm="11" md="11" lg="11" className="general-header page-title">
            <h1>General Information</h1>
          </Col>
          <Col sm="1" md="1" lg="1">
            <Button
              className="float-right cta"
              onClick={() => {
                this.setState({ctaButtonPressed: true});

                isStaked
                  ? this.setState({unstake: true})
                  : this.setState({stake: true});
              }}
              variant="primary"
            >
              <span>{isStaked ? "Unstake" : "Stake"}</span>
            </Button>
          </Col>
        </Row>
        <Row className="stats">
          {generalInfo.map((card, idx) => (
            <Col key={idx}>
              <InfoCard title={card.title} subtitle={card.subtitle}>
                {card.children || <br />}
              </InfoCard>
            </Col>
          ))}
        </Row>
        <Row>
          <Col className={chains.length === 0 ? "mb-1" : ""}>
            <Segment scroll={false} label="Networks">
              <AppTable
                scroll
                toggle={chains.length > 0}
                keyField="hash"
                data={chains}
                columns={TABLE_COLUMNS.NETWORK_CHAINS}
                bordered={false}
              />
            </Segment>
          </Col>
        </Row>
        <Row className="item-data">
          <Col sm="6" md="6" lg="6">
            <div className="page-title">
              <h2>Address</h2>
              <Alert variant="light">{address}</Alert>
            </div>
          </Col>
          <Col sm="6" md="6" lg="6">
            <div className="page-title">
              <h2>Public Key</h2>
              <Alert variant="light">{publicKey}</Alert>
            </div>
          </Col>
        </Row>
        <Row className="contact-info">
          {contactInfo.map((card, idx) => (
            <Col key={idx} sm="6" md="6" lg="6">
              <InfoCard
                className={"contact"}
                title={card.title}
                subtitle={card.subtitle}
              >
                <span />
              </InfoCard>
            </Col>
          ))}
        </Row>
        <Row className="action-buttons">
          <Col sm="3" md="3" lg="3">
            <span className="option">
              <img src={"/assets/edit.svg"} alt="edit-action-icon" />
              <p>
                <Link
                  to={() => {
                    const url = _getDashboardPath(DASHBOARD_PATHS.nodeEdit);

                    return url.replace(":address", address);
                  }}
                >
                  Edit
                </Link>{" "}
                to change your node description.
              </p>
            </span>
          </Col>
          <Col sm="3" md="3" lg="3">
            <span className="option">
              <img src={"/assets/trash.svg"} alt="trash-action-icon" />
              <p>
                <span
                  className="link"
                  onClick={() => this.setState({deleteModal: true})}
                >
                  Remove
                </span>{" "}
                this Node from the Dashboard.
              </p>
            </span>
          </Col>
        </Row>
        <Modal
          show={deleteModal}
          onHide={() => this.setState({deleteModal: false})}
          animation={false}
          centered
          dialogClassName="app-modal"
        >
          <Modal.Header closeButton></Modal.Header>
          <Modal.Body>
            <h4> Are you sure you want to remove this Node?</h4>
            Your Node will be removed from the Pocket Dashboard. However, you
            will be able access it through the command line interface (CLI) or
            import it back into Pocket Dashboard with the private key assigned
            to it.
          </Modal.Body>
          <Modal.Footer>
            <Button
              className="dark-button"
              onClick={() => this.setState({deleteModal: false})}
            >
              <span>Cancel</span>
            </Button>
            <Button onClick={this.deleteNode}>
              <span>Remove</span>
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  }
}

export default NodeDetail;
