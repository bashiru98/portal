import PocketBaseService from "./PocketBaseService";
import PocketUserService from "./PocketUserService";
import axios from "axios";
import {ITEM_TYPES} from "../../_constants";

class PocketStripePaymentService extends PocketBaseService {

  constructor() {
    super("api/payments");
  }

  /**
   * Save payment method for use later.
   *
   * @param {string} paymentMethodID Payment method ID to save.
   * @param {object} billingDetails Billing details used on this payment method.
   *
   * @returns {Promise<*>}
   * @private
   */
  __savePaymentMethod(paymentMethodID, billingDetails) {
    const user = PocketUserService.getUserInfo().email;
    const data = {id: paymentMethodID, user, billingDetails};

    return axios.post(this._getURL("payment_method"), data)
      .then(response => response.data).catch(err => err.response);
  }

  /**
   * Mark payment as success on history.
   *
   * @param {string} paymentID Payment intent ID used.
   * @param {string} paymentMethodID Payment method ID to save.
   * @param {object} billingDetails Billing details used on this payment method.
   *
   * @returns {Promise<*>}
   * @private
   */
  async __markPaymentAsSuccess(paymentID, paymentMethodID, billingDetails) {
    const user = PocketUserService.getUserInfo().email;
    const data = {paymentID, user, paymentMethodID, billingDetails};

    return axios.put(this._getURL("history"), data)
      .then(response => response.data);
  }

  /**
   * Create a new payment method.
   *
   * @param {object} stripe Stripe object.
   * @param {object} card Card used to confirm payment.
   * @param {{name:string, [address]:{line1:string, [postal_code]:string, country:string}}} billingDetails Billing details about card.
   *
   * @return {Promise<*>}
   * @async
   */
  async createPaymentMethod(stripe, card, billingDetails) {
    if (!stripe || !card) {
      return false;
    }

    const cardData = {
      type: "card",
      card: card,
      billing_details: billingDetails
    };

    return stripe.createPaymentMethod(cardData)
      .then(result => {
        if (result.paymentMethod) {
          this.__savePaymentMethod(result.paymentMethod.id, billingDetails);
        }

        return result;
      });
  }

  /**
   * Confirm payment with new card.
   * If payment is success, the payment method will save for later and mark payment success on history.
   *
   * @param {object} stripe Stripe object.
   * @param {string} paymentIntentSecretID Payment intent to confirm.
   * @param {object} card Card used to confirm payment.
   * @param {{name:string, [address]:{line1:string, [postal_code]:string, country:string}}} billingDetails Billing details about card.
   *
   * @return {Promise<*>}
   * @async
   */
  async confirmPaymentWithNewCard(stripe, paymentIntentSecretID, card, billingDetails) {
    if (!stripe || !card) {
      return false;
    }

    const cardPaymentData = {
      payment_method: {
        card,
        billing_details: billingDetails
      }
    };

    return stripe.confirmCardPayment(paymentIntentSecretID, cardPaymentData)
      .then(result => {
        if (result.paymentIntent) {
          const paymentIntent = result.paymentIntent;

          if (paymentIntent.status.toLowerCase() === "succeeded") {
            this.__savePaymentMethod(paymentIntent.payment_method, billingDetails);
            this.__markPaymentAsSuccess(paymentIntent.id, paymentIntent.payment_method, billingDetails);
          }
        }

        return result;
      });
  }

  /**
   * Confirm payment with a saved card.
   *
   * @param {object} stripe Stripe object.
   * @param {string} paymentIntentSecretID Payment intent to confirm.
   * @param {string} paymentMethodID saved card id for purchase.
   * @param {{name:string, [address]:{line1:string, [postal_code]:string,
   *         country:string}}} billingDetails Billing details about card.
   * @return {Promise<*>}
   * @async
   */
  async confirmPaymentWithSavedCard(stripe, paymentIntentSecretID, paymentMethodID, billingDetails) {
    if (!stripe || !paymentIntentSecretID || !paymentMethodID) {
      return false;
    }

    const cardPaymentData = {
      payment_method: paymentMethodID,
    };

    return stripe.confirmCardPayment(paymentIntentSecretID, cardPaymentData).then(result => {
      if (result.paymentIntent) {
        const paymentIntent = result.paymentIntent;

        if (paymentIntent.status.toLowerCase() === "succeeded") {
          this.__markPaymentAsSuccess(paymentIntent.id, paymentIntent.payment_method, billingDetails);
        }
      }

      return result;
    });
  }

  /**
   * Create new payment intent for purchase.
   *
   * @param {string} type type of item (e.x. application, node).
   * @param {object} item item to purchase data.
   * @param {string} currency currency.
   * @param {number} amount amount to pay.
   *
   * @return {Promise<*>}
   * @async
   */
  async createNewPaymentIntent(type, item, currency, amount) {
    const user = PocketUserService.getUserInfo().email;
    const data = {type: "card", user, item, currency, amount};

    let path;

    if (type === ITEM_TYPES.APPLICATION) {
      path = "apps";
    } else if (type === ITEM_TYPES.NODE) {
      path = "nodes";
    } else {
      throw new Error("Invalid item type");
    }

    return axios
      .post(this._getURL(`new_intent/${path}`), data)
      .then((response) => {
        return {success: true, data: response.data};
      })
      .catch((err) => {
        return {success: false, data: err.response};
      });
  }
}

export default new PocketStripePaymentService();
