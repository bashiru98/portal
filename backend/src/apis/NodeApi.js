import express from "express";
import NodeService from "../services/NodeService";
import {getOptionalQueryOption, getQueryOption} from "./_helpers";
import PaymentService from "../services/PaymentService";
import EmailService from "../services/EmailService";
import ApplicationCheckoutService from "../services/ApplicationCheckoutService";

const router = express.Router();

const nodeService = new NodeService();
const paymentService = new PaymentService();
const checkoutService = ApplicationCheckoutService.getInstance();

/**
 * Create new node.
 */
router.post("", async (request, response) => {
  try {
    /** @type {{node: {name:string, contactEmail:string, user:string, owner:string, description:string, icon:string}, privateKey?:string, nodeBaseLink:string}} */
    let data = request.body;

    if (!("privateKey" in data)) {
      data["privateKey"] = "";
    }

    const node = await nodeService.createNode(data.node, data.privateKey);
    const emailAction = data.privateKey ? "imported" : "created";
    const nodeEmailData = {
      name: data.node.name,
      link: `${data.nodeBaseLink}/${node.privateNodeData.address}`
    };

    await EmailService
      .to(data.node.contactEmail)
      .sendCreateOrImportNodeEmail(emailAction, data.node.contactEmail, nodeEmailData);

    response.send(node);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Update a node.
 */
router.put("/:nodeAccountAddress", async (request, response) => {
  try {
    /** @type {{name:string, contactEmail:string, user:string, operator:string, description:string, icon:string}} */
    let data = request.body;

    /** @type {{nodeAccountAddress: string}} */
    const params = request.params;

    const updated = await nodeService.updateNode(params.nodeAccountAddress, data);

    response.send(updated);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Import node from network.
 */
router.get("import/:nodeAccountAddress", async (request, response) => {
  try {
    /** @type {{nodeAccountAddress:string}} */
    const data = request.params;
    const node = await nodeService.importNode(data.nodeAccountAddress);

    response.send(node);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Delete a node from dashboard.
 */
router.post("/:nodeAccountAddress", async (request, response) => {
  try {

    /** @type {{nodeAccountAddress:string}} */
    const data = request.params;
    /** @type {{user:string, nodesLink:string}} */
    const bodyData = request.body;

    const node = await nodeService.deleteNode(data.nodeAccountAddress, bodyData.user);

    if (node) {
      const nodeEmailData = {
        name: node.name,
        nodesLink: bodyData.nodesLink
      };

      await EmailService
        .to(node.contactEmail)
        .sendNodeDeletedEmail(node.contactEmail, nodeEmailData);
    }

    response.send(node !== undefined);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Get node that is already on dashboard by address.
 */
router.get("/:nodeAccountAddress", async (request, response) => {
  try {
    /** @type {{nodeAccountAddress:string}} */
    const data = request.params;
    const node = await nodeService.getNode(data.nodeAccountAddress);

    response.send(node);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});


/**
 * Get all nodes.
 */
router.get("", async (request, response) => {
  try {

    const limit = parseInt(getQueryOption(request, "limit"));

    const offsetData = getOptionalQueryOption(request, "offset");
    const offset = offsetData !== "" ? parseInt(offsetData) : 0;

    const statusData = getOptionalQueryOption(request, "status");
    const stakingStatus = statusData !== "" ? parseInt(statusData) : undefined;

    const nodes = await nodeService.getAllNodes(limit, offset, stakingStatus);

    response.send(nodes);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Get all user nodes.
 */
router.post("/user/all", async (request, response) => {
  try {

    const limit = parseInt(getQueryOption(request, "limit"));

    const offsetData = getOptionalQueryOption(request, "offset");
    const offset = offsetData !== "" ? parseInt(offsetData) : 0;

    const statusData = getOptionalQueryOption(request, "status");
    const stakingStatus = statusData !== "" ? parseInt(statusData) : undefined;

    /** @type {{user: string}} */
    const data = request.body;

    const nodes = await nodeService.getUserNodes(data.user, limit, offset, stakingStatus);

    response.send(nodes);
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Stake a node.
 */
router.post("/stake", async (request, response) => {
  try {

    /** @type {{node: {privateKey: string, passPhrase: string, networkChains: string[], serviceURL: string}, payment:{id: string}, nodeLink: string}} */
    const data = request.body;
    const paymentHistory = await paymentService.getPaymentFromHistory(data.payment.id);

    if (paymentHistory.isSuccessPayment(true)) {

      if (paymentHistory.isNodePaymentItem(true)) {
        const item = paymentHistory.getItem();
        const poktToStake = checkoutService.getPoktToStake(paymentHistory.amount);

        const node = await nodeService.stakeNode(data.node, poktToStake.toString());

        if (node) {
          const nodeEmailData = {
            name: node.name,
            link: data.nodeLink
          };

          const paymentEmailData = {
            amountPaid: paymentHistory.amount,
            validatorPowerAmount: item.validatorPower,
            poktStaked: poktToStake.toString()
          };

          await EmailService
            .to(node.contactEmail)
            .sendStakeNodeEmail(node.contactEmail, nodeEmailData, paymentEmailData);

          response.send(true);
        } else {
          response.send(false);
        }
      }
    }
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * Unstake a node.
 */
router.post("/unstake", async (request, response) => {
  try {

    /** @type {{node:{privateKey:string, passPhrase:string, accountAddress: string}, nodeLink: string}} */
    const data = request.body;

    const node = await nodeService.unstakeNode(data.node);

    if (node) {
      const nodeEmailData = {
        name: node.name,
        link: data.nodeLink
      };

      await EmailService
        .to(node.contactEmail)
        .sendUnstakeNodeEmail(node.contactEmail, nodeEmailData);

      response.send(true);
    } else {
      response.send(false);
    }
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});

/**
 * UnJail a node.
 */
router.post("/unjail", async (request, response) => {
  try {

    /** @type {{node:{privateKey:string, passPhrase:string, accountAddress: string}, nodeLink: string}} */
    const data = request.body;

    const node = await nodeService.unJailNode(data.node);

    if (node) {
      const nodeEmailData = {
        name: node.name,
        link: data.nodeLink
      };

      await EmailService
        .to(node.contactEmail)
        .sendNodeUnJailedEmail(node.contactEmail, nodeEmailData);

      response.send(true);
    } else {
      response.send(false);
    }
  } catch (e) {
    const error = {
      message: e.toString()
    };

    response.status(400).send(error);
  }
});


export default router;
