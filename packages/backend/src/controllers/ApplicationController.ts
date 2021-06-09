import express, { Response, Request } from "express";
import crypto from "crypto";
import asyncMiddleware from "../middlewares/async";
import { authenticate } from "../middlewares/passport-auth";
import Application, { IApplication } from "../models/Application";
import ApplicationPool, { IPreStakedApp } from "../models/PreStakedApp";
import { IUser } from "../models/User";
import HttpError from "../errors/http-error";
import MailgunService from "../services/MailgunService";
import { getApp } from "../lib/pocket";
import { APPLICATION_STATUSES } from "../application-statuses";

const DEFAULT_GATEWAY_SETTINGS = {
  secretKey: "",
  secretKeyRequired: false,
  whitelistOrigins: [],
  whitelistUserAgents: [],
};

const router = express.Router();

router.use(authenticate);

router.get(
  "",
  asyncMiddleware(async (req: Request, res: Response) => {
    const id = (req.user as IUser)._id;
    const application = await Application.find({
      status: APPLICATION_STATUSES.READY,
      user: id,
    });

    if (!application) {
      throw HttpError.NOT_FOUND({
        errors: [
          {
            id: "NONEXISTENT_APPLICATION",
            message: "User does not have an active application",
          },
        ],
      });
    }
    res.status(200).send(application);
  })
);

router.get(
  "/:applicationId",
  asyncMiddleware(async (req: Request, res: Response) => {
    const userId = (req.user as IUser)._id;
    const { applicationId } = req.params;
    const application: IApplication = await Application.findById(applicationId);

    if (!application) {
      throw HttpError.NOT_FOUND({
        errors: [
          {
            id: "NONEXISTENT_APPLICATION",
            message: "User does not have an active application",
          },
        ],
      });
    }
    if (application.user.toString() !== userId.toString()) {
      throw HttpError.FORBIDDEN({
        errors: [
          {
            id: "UNAUTHORIZED_ACCESS",
            message: "User does not have access to this application",
          },
        ],
      });
    }

    res.status(200).send(application);
  })
);

router.get(
  "/status/:applicationId",
  asyncMiddleware(async (req: Request, res: Response) => {
    const userId = (req.user as IUser)._id;
    const { applicationId } = req.params;
    const application: IApplication = await Application.findById(applicationId);

    if (!application) {
      throw HttpError.NOT_FOUND({
        errors: [
          {
            id: "NONEXISTENT_APPLICATION",
            message: "User does not have an active application",
          },
        ],
      });
    }
    if (application.user.toString() !== userId.toString()) {
      throw HttpError.FORBIDDEN({
        errors: [
          {
            id: "UNAUTHORIZED_ACCESS",
            message: "User does not have access to this application",
          },
        ],
      });
    }
    const app = await getApp(application.freeTierApplicationAccount.address);

    res.status(200).send(app);
  })
);

router.post(
  "",
  asyncMiddleware(async (req: Request, res: Response) => {
    const {
      name,
      chain,
      gatewaySettings = DEFAULT_GATEWAY_SETTINGS,
    } = req.body;

    try {
      const id = (req.user as IUser)._id;
      const isNewAppRequestInvalid = await Application.exists({
        status: APPLICATION_STATUSES.READY,
        user: id,
      });

      if (isNewAppRequestInvalid) {
        throw HttpError.BAD_REQUEST({
          errors: [
            {
              id: "ALREADY_EXISTING",
              message: "User already has an existing free tier app",
            },
          ],
        });
      }
      const preStakedApp: IPreStakedApp = await ApplicationPool.findOne({
        status: APPLICATION_STATUSES.READY,
        chain,
      });

      if (!preStakedApp) {
        throw HttpError.BAD_REQUEST({
          errors: [
            {
              id: "POOL_EMPTY",
              message: "No pre-staked apps available for this chain.",
            },
          ],
        });
      }
      const application = new Application({
        chain,
        name,
        user: id,
        status: APPLICATION_STATUSES.READY,
        lastChangedStatusAt: new Date(Date.now()),
        // We enforce every app to be treated as a free-tier app for now.
        freeTier: true,
        freeTierApplicationAccount: preStakedApp.freeTierApplicationAccount,
        gatewayAAT: preStakedApp.gatewayAAT,
        gatewaySettings: {
          ...gatewaySettings,
        },
      });

      application.gatewaySettings.secretKey = crypto
        .randomBytes(16)
        .toString("hex");
      await application.save();
      const { ok } = await ApplicationPool.deleteOne({ _id: preStakedApp._id });

      if (Number(ok) !== 1) {
        throw HttpError.INTERNAL_SERVER_ERROR({
          errors: [
            {
              id: "DB_ERROR",
              message: "There was an error while updating the DB",
            },
          ],
        });
      }
      res.status(200).send(application);
    } catch (err) {
      throw HttpError.INTERNAL_SERVER_ERROR(err);
    }
  })
);

router.put(
  "/:applicationId",
  asyncMiddleware(async (req: Request, res: Response) => {
    const { gatewaySettings } = req.body;
    const { applicationId } = req.params;

    try {
      const application: IApplication = await Application.findById(
        applicationId
      );

      if (!application) {
        throw HttpError.BAD_REQUEST({
          errors: [
            { id: "NONEXISTENT_APPLICATION", message: "Application not found" },
          ],
        });
      }
      const userId = (req.user as IUser)._id;

      if (application.user.toString() !== userId.toString()) {
        throw HttpError.BAD_REQUEST({
          errors: [
            {
              id: "UNAUTHORIZED_ACCESS",
              message: "Application does not belong to user",
            },
          ],
        });
      }
      application.gatewaySettings = gatewaySettings;
      await application.save();
      // lodash's merge mutates the target object passed in.
      // This is what we want, as we don't want to lose any of the mongoose functionality
      // while at the same time updating the model itself
      res.status(204).send();
    } catch (err) {
      throw HttpError.INTERNAL_SERVER_ERROR(err);
    }
  })
);

router.post(
  "/switch/:applicationId",
  asyncMiddleware(async (req: Request, res: Response) => {
    const { chain } = req.body;
    const { applicationId } = req.params;

    try {
      const replacementApplication: IPreStakedApp = await ApplicationPool.findOne(
        {
          chain,
          status: APPLICATION_STATUSES.READY,
        }
      );

      if (!replacementApplication) {
        throw new Error("No application for the selected chain is available");
      }
      const oldApplication: IApplication = await Application.findById(
        applicationId
      );

      if (!oldApplication) {
        throw new Error("Cannot find application");
      }
      if (
        oldApplication.user.toString() !== (req.user as IUser)._id.toString()
      ) {
        throw HttpError.FORBIDDEN({
          errors: [
            {
              id: "FOREIGN_APPLICATION",
              message: "Application does not belong to user",
            },
          ],
        });
      }

      oldApplication.status = APPLICATION_STATUSES.AWAITING_GRACE_PERIOD;
      oldApplication.lastChangedStatusAt = Date.now();
      await oldApplication.save();
      // Create a new Application for the user and copy the previous user config
      const newReplacementApplication = new Application({
        // As we're moving to a new chain, everything related to the account and gateway AAT
        // information will change, so we use all the data from the application that we took
        // from the pool.
        chain: replacementApplication.chain,
        freeTierApplicationAccount:
          replacementApplication.freeTierApplicationAccount,
        gatewayAAT: replacementApplication.gatewayAAT,
        status: APPLICATION_STATUSES.READY,
        lastChangedStatusAt: Date.now(),
        freeTier: true,
        // We wanna preserve user-related configuration fields, so we just copy them over
        // from the old application.
        name: oldApplication.name,
        user: oldApplication.user,
        gatewaySettings: oldApplication.gatewaySettings,
      });

      await newReplacementApplication.save();
      res.status(200).send(newReplacementApplication);
    } catch (err) {
      throw HttpError.INTERNAL_SERVER_ERROR(err);
    }
  })
);

router.put(
  "/notifications/:applicationId",
  asyncMiddleware(async (req: Request, res: Response) => {
    const { applicationId } = req.params;
    const { quarter, half, threeQuarters, full } = req.body;
    const application = await Application.findById(applicationId);

    if (!application) {
      throw HttpError.BAD_REQUEST({
        errors: [
          {
            id: "NONEXISTENT_APPLICATION",
            message: "This application does not exist",
          },
        ],
      });
    }
    if (
      (application as IApplication).user.toString() !==
      (req.user as IUser)._id.toString()
    ) {
      throw HttpError.FORBIDDEN({
        errors: [
          {
            id: "FOREIGN_APPLICATION",
            message: "Application does not belong to user",
          },
        ],
      });
    }
    const emailService = new MailgunService();
    const isSignedUp = (application as IApplication).notificationSettings
      .signedUp;
    const hasOptedOut = !(quarter || half || threeQuarters || full);

    (application as IApplication).notificationSettings = {
      signedUp: hasOptedOut ? false : true,
      quarter,
      half,
      threeQuarters,
      full,
    };
    await application.save();
    if (!isSignedUp) {
      emailService.send({
        templateName: "NotificationSignup",
        toEmail: (req.user as IUser).email,
      });
    } else {
      emailService.send({
        templateName: "NotificationChange",
        toEmail: (req.user as IUser).email,
      });
    }
    return res.status(204).send();
  })
);
export default router;