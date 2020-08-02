import React from "react";
import "./SelectValidatorPower.scss";
import {Col, Row} from "react-bootstrap";
import AppSlider from "../../../core/components/AppSlider";
import {ITEM_TYPES, PURCHASE_ITEM_NAME} from "../../../_constants";
import {formatNumbers, scrollToId} from "../../../_helpers";
import PaymentService from "../../../core/services/PocketPaymentService";
import PocketPaymentService from "../../../core/services/PocketPaymentService";
import numeral from "numeral";
import AppAlert from "../../../core/components/AppAlert";
import PocketCheckoutService from "../../../core/services/PocketCheckoutService";
import Loader from "../../../core/components/Loader";
import PocketAccountService from "../../../core/services/PocketAccountService";
import {_getDashboardPath, DASHBOARD_PATHS} from "../../../_routes";
import AppOrderSummary from "../../../core/components/AppOrderSummary/AppOrderSummary";
import Purchase from "../../../core/components/Purchase/Purchase";
import NodeService from "../../../core/services/PocketNodeService";

class SelectValidatorPower extends Purchase {
  // TODO: On a later release, find a way to simplify the code and reduce
  //  duplication.
  constructor(props, context) {
    super(props, context);

    this.onSliderChange = this.onSliderChange.bind(this);
    this.onCurrentBalanceChange = this.onCurrentBalanceChange.bind(this);
    this.goToSummary = this.goToSummary.bind(this);
  }

  componentDidMount() {
    const {
      address: accountAddress,
    } = NodeService.getNodeInfo();

    PaymentService.getAvailableCurrencies().then((currencies) => {
      PocketCheckoutService.getValidatorPower().then((validatorPower) => {
        const minPowerValidator = parseInt(validatorPower.min);

        PocketCheckoutService.getNodeMoneyToSpent(minPowerValidator).then(
          ({cost}) => {
            PocketAccountService.getBalance(accountAddress).then(
              ({balance}) => {
                const currentAccountBalance = parseFloat(balance);
                const subTotal = parseFloat(cost);
                const total = subTotal - currentAccountBalance;

                this.setState({
                  currentAccountBalance: currentAccountBalance,
                  originalAccountBalance: currentAccountBalance,
                  min: minPowerValidator,
                  max: parseInt(validatorPower.max),
                  loading: false,
                  selected: minPowerValidator,
                  subTotal,
                  total,
                  type: ITEM_TYPES.NODE,
                });
              }
            );
          }
        );
      });

      this.setState({currencies});
    });
  }

  onCurrentBalanceChange(e) {
    let {selected} = this.state;
    const {
      target: {value},
    } = e;
    const currentAccountBalance = parseFloat(value);

    PocketCheckoutService.getNodeMoneyToSpent(selected).then(({cost}) => {
      const subTotal = parseFloat(cost);
      const total = subTotal - currentAccountBalance;

      this.setState({
        currentAccountBalance: currentAccountBalance,
        total,
        subTotal,
      });
    });
  }

  onSliderChange(value) {
    const {currentAccountBalance} = this.state;

    PocketCheckoutService.getNodeMoneyToSpent(value).then(({cost}) => {
      const subTotal = parseFloat(cost);
      const total = subTotal - currentAccountBalance;

      this.setState({selected: value, subTotal, total});
    });
  }

  async createPaymentIntent(validatorPower, currency, amount) {
    const {address} = NodeService.getNodeInfo();
    const {pocketNode} = await NodeService.getNode(address);

    const item = {
      account: address,
      name: pocketNode.name,
      validatorPower,
    };

    const {
      success,
      data: paymentIntentData,
    } = await PocketPaymentService.createNewPaymentIntent(
      ITEM_TYPES.NODE, item, currency, parseFloat(amount)
    );

    if (!success) {
      throw new Error(paymentIntentData.data.message);
    }

    return {success, data: paymentIntentData};
  }

  async goToSummary() {
    const {
      selected,
      currencies,
      subTotal,
      total,
      currentAccountBalance,
    } = this.state;

    this.setState({loading: true});

    // At the moment the only available currency is USD.
    const currency = currencies[0];

    try {
      this.validate(currency);

      // Avoiding floating point precision errors.
      const subTotalAmount = parseFloat(
        numeral(subTotal).format("0.000")
      ).toFixed(3);
      const totalAmount = parseFloat(numeral(total).format("0.000")).toFixed(3);

      const {data: paymentIntentData} = await this.createPaymentIntent(
        selected, currency, totalAmount
      );

      PaymentService.savePurchaseInfoInCache({
        validationPower: parseInt(selected),
        validationPowerCost: parseFloat(totalAmount),
      });

      // eslint-disable-next-line react/prop-types
      this.props.history.push({
        pathname: _getDashboardPath(DASHBOARD_PATHS.orderSummary),
        state: {
          type: ITEM_TYPES.NODE,
          paymentIntent: paymentIntentData,
          quantity: {
            number: selected,
            description: PURCHASE_ITEM_NAME.NODES,
          },
          cost: {
            number: subTotalAmount,
            description: `${PURCHASE_ITEM_NAME.NODES} cost`,
          },
          total: totalAmount,
          currentAccountBalance,
        },
      });
    } catch (e) {
      this.setState({
        error: {show: true, message: <h4>{e.toString()}</h4>},
        loading: false,
      });
      scrollToId("alert");
    }
  }

  render() {
    const {
      error,
      currencies,
      selected,
      subTotal,
      total,
      min,
      max,
      currentAccountBalance,
      loading,
    } = this.state;

    // At the moment the only available currency is USD.
    const currency = currencies[0];
    const subTotalFixed = numeral(subTotal).format("$0,0.000");
    const totalFixed = numeral(total).format("$0,0.000");

    if (loading) {
      return <Loader />;
    }

    return (
      <div id="purchase">
        <Row>
          <Col className="title-page">
            {error.show && (
              <AppAlert
                variant="danger"
                title={error.message}
                dismissible
                onClose={() => this.setState({error: false})}
              />
            )}
            <h1>Run actually decentralized infrastructure</h1>
            <p className="subtitle">
              15,000 POKT is the minimum stake to run a node. By increasing the Validator Power (VP) beyond the minimum stake, odds are increased that a node will be selected to produce blocks and receive the block reward. <b>Best Practices:</b> If a node stake at any time falls below the minimum stake for any reason, the stake will be burned by the protocol. For this reason, we recommend staking at least 10% beyond the minimum stake to account for any accidental or unforeseen slashing due to misconfiguration.
            </p>
          </Col>
        </Row>
        <Row>
          <Col sm="7" className="relays-column">
            <h2>
              SLIDE TO SELECT VALIDATOR POWER
            </h2>
            <div className="calc">
              <div className="slider-wrapper">
                <AppSlider
                  defaultValue={min}
                  onChange={this.onSliderChange}
                  type={PURCHASE_ITEM_NAME.NODES}
                  marks={{
                    [min]: `${formatNumbers(min)} VP`,
                    [max]: `${formatNumbers(max)} VP*`,
                  }}
                  min={min}
                  max={max}
                />
              </div>
            </div>
            <AppAlert
              className="max-alert"
              variant="primary"
              title={<h4 className="alert-max">About VP, Validator Power:</h4>}
            >
              <p className="alert-max">
                Each VP unite purchased on the Pocket Dashboard has a representation as POKT token on the Pocket Network. 1VP=  1POKT
                <br />
                <br />
                *Need More validator power? If you're interested in more validator power beyond the maximum on the dashboard, please contact us.
              </p>
            </AppAlert>
          </Col>
          <Col sm="5" className="order-summary-column">
            <h2>Order Summary</h2>
            <AppOrderSummary
              items={[
                {label: "Node", quantity: 1},
                {label: PURCHASE_ITEM_NAME.NODES, quantity: selected},
                {
                  label: `${PURCHASE_ITEM_NAME.NODES} cost`,
                  quantity: `${subTotalFixed} ${currency.toUpperCase()}`,
                },
              ]}
              balance={currentAccountBalance}
              balanceOnChange={this.onCurrentBalanceChange}
              total={totalFixed}
              loading={loading}
              formActionHandler={this.goToSummary}
              // At the moment, we're only using  USD
              currency={currencies[0]}
            />
          </Col>
        </Row>
        <Row>
          <Col></Col>
        </Row>
      </div>
    );
  }
}

export default SelectValidatorPower;
