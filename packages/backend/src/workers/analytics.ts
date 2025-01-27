import { Types } from 'mongoose'
import * as Amplitude from '@amplitude/node'
import { influx, buildAnalyticsQuery } from '../lib/influx'
import Application from '../models/Application'
import LoadBalancer from '../models/LoadBalancer'
import User from '../models/User'
import { composeHoursFromNowUtcDate } from '../lib/date-utils'
import env from '../environment'

interface IUserProfile {
  email: string
  endpointIds: string[]
  endpointNames: string[]
  numberOfEndpoints: number
  publicKeys: string[]
  publicKeysPerEndpoint: number[]
}

interface IRelayMetricUpdate {
  amount: number
  chainID: string
  endpointID: string
  endpointName: string
  endpointPublicKeys: string[]
}

interface UsageByID {
  chain: string
  usage: number
}

interface UserProfileUpdate {
  userProfile: IUserProfile
  metricUpdates: IRelayMetricUpdate[]
}

const DEFAULT_USER_PROFILE = {
  email: '',
  endpointIds: [],
  endpointNames: [],
  numberOfEndpoints: 0,
  publicKeys: [],
  publicKeysPerEndpoint: [],
} as IUserProfile

const { isValid } = Types.ObjectId
const ORPHANED_KEY = 'ORPHANED'

export async function fetchUsedApps(
  ctx: any
): Promise<Map<string, UsageByID[]>> {
  const rawAppsUsed = await influx.collectRows(
    buildAnalyticsQuery({
      start: composeHoursFromNowUtcDate(1),
      stop: composeHoursFromNowUtcDate(0),
    })
  )

  const appsUsed = new Map<string, number>()

  let totalEndpointUsage = 0

  rawAppsUsed.map(({ _value, applicationPublicKey, blockchain }) => {
    const publicKeyChainID = `${applicationPublicKey}-${blockchain}`
    const total = appsUsed.get(publicKeyChainID) ?? 0
    appsUsed.set(publicKeyChainID, total + _value)
    totalEndpointUsage += _value
  })

  ctx.logger.info(
    `Got ${rawAppsUsed.length} apps used with a total usage of ${totalEndpointUsage}`
  )

  const appsUsedByChain = new Map<string, UsageByID[]>()

  totalEndpointUsage = 0

  for (const [applicationPublicKeyWithChain, usage] of appsUsed.entries()) {
    const [applicationPublicKey, chainID] =
      applicationPublicKeyWithChain.split('-')
    const usageByChain = appsUsedByChain.get(applicationPublicKey) ?? []
    usageByChain.push({ chain: chainID, usage })
    appsUsedByChain.set(applicationPublicKey, usageByChain)
    totalEndpointUsage += usage
  }

  ctx.logger.info(
    `Got ${rawAppsUsed.length} apps used with a total usage of ${totalEndpointUsage}`
  )
  return appsUsedByChain
}

// mapUsageToProfiles gets the apps used by chain,
// finds their parent lb (or app if no lb is found),
// finds their parent user,
// and builds the relay metric update and the complete user property profile for the
// particular user
export async function mapUsageToProfiles(
  appsUsedByChain: Map<string, UsageByID[]>,
  ctx: any
): Promise<
  Map<
    string,
    { userProfile: IUserProfile; metricUpdates: IRelayMetricUpdate[] }
  >
> {
  // TODO
  const dbApps = await Application.find()
  const dbLBs = await LoadBalancer.find()
  const userProfiles = new Map<string, UserProfileUpdate>()

  let totalUsageProcessed = 0
  for (const [publicKey, usageByChain] of appsUsedByChain.entries()) {
    const app = dbApps.find(
      (application) =>
        application?.freeTierApplicationAccount?.publicKey === publicKey ||
        application?.gatewayAAT?.applicationPublicKey === publicKey
    )

    const totalUsage = usageByChain.reduce(
      (total, usageByID) => total + usageByID.usage,
      0
    )

    // If the public key doesn't match to any app, just skip it. While this should probably not happen,
    // it's best to log a warning if it does and bail.
    if (!app) {
      ctx.logger.error(
        `No app found for public key ${publicKey} but presents an usage of ${totalUsage}.`
      )

      continue
    }

    // If there's at least an app, we have two options:
    // - Categorize it as an app without an LB associated with it.
    // We'll assume all of these apps are "orphaned", as they are very old endpoints that cannot
    // be accessed through the portal UI anymore unless they're coupled with an LB
    // - Find their LB, and associate the LB with the app.
    // When doing this
    const lb = dbLBs.find((lb) =>
      lb.applicationIDs.find((id) => id === app?._id?.toString())
    )

    if (!lb) {
      ctx.logger.warn(
        `No LB found for app ${app._id?.toString()} [${
          app.name
        }], but presents usage ${totalUsage}. Categorizing as "orphaned" app.`
      )

      // as this is the orphaned apps profile, get it with the orphan app key
      const { userProfile = DEFAULT_USER_PROFILE, metricUpdates = [] } =
        userProfiles.get(ORPHANED_KEY) ?? {
          userProfile: DEFAULT_USER_PROFILE,
          metricUpdates: [],
        }

      // Build the updated user profile
      const updatedUserProfile = {
        ...userProfile,
        email: ORPHANED_KEY,
        endpointIds: [...userProfile.endpointIds, app._id?.toString() ?? ''],
        endpointNames: [...userProfile.endpointNames, app?.name ?? ''],
        numberOfEndpoints: userProfile.numberOfEndpoints + 1,
        publicKeys: [...userProfile.publicKeys, publicKey],
        // We know this is one as it's only 1 public key per app
        publicKeysPerEndpoint: [...userProfile.publicKeysPerEndpoint, 1],
      } as IUserProfile

      // Build the updated metric relay update
      const newMetricUpdates = usageByChain.map((usagePerChain) => {
        totalUsageProcessed += usagePerChain.usage

        return {
          amount: usagePerChain.usage,
          chainID: usagePerChain.chain,
          endpointID: app._id?.toString(),
          endpointName: app.name,
          endpointPublicKeys: [publicKey],
        } as IRelayMetricUpdate
      })

      // Append the new metric updates
      const updatedMetricUpdates = [...metricUpdates, ...newMetricUpdates]

      userProfiles.set(ORPHANED_KEY, {
        userProfile: updatedUserProfile,
        metricUpdates: updatedMetricUpdates,
      })
    } else {
      const userID = lb?.user?.toString() ?? ''
      const isUserIDValid = isValid(userID)
      const user = isUserIDValid ? await User.findById(userID) : null
      const userKey = user ? userID : ORPHANED_KEY

      if (!user) {
        ctx.logger.warn(
          `${lb._id?.toString()} [${
            lb.name
          }] has usage ${totalUsage} but is not associated with any user.`
        )
      }

      // Get the current endpoints from this user. Will just be an empty array if there's no user.
      const userEndpoints =
        dbLBs.filter((lb) => lb?.user?.toString() === userID) ?? []

      // Get all the apps in this loadbalancer.
      const currentEndpointApps =
        lb.applicationIDs
          .map((id) =>
            dbApps.find((app) => app._id?.toString() === id?.toString())
          )
          .filter((id) => id) ?? []

      // get the lb user profile
      const { userProfile = DEFAULT_USER_PROFILE, metricUpdates = [] } =
        userProfiles.get(userKey) ?? {
          userProfile: DEFAULT_USER_PROFILE,
          metricUpdates: [],
        }

      // Build the updated user profile
      const updatedUserProfile = {
        ...userProfile,
        email: user ? user.email : ORPHANED_KEY,
        endpointIds: [...userProfile.endpointIds, lb._id?.toString() ?? ''],
        endpointNames: [...userProfile.endpointNames, lb?.name ?? ''],
        numberOfEndpoints: user
          ? // Either the amount of user endpoints we found (or 1 if we didn't find one for some reason)
            userEndpoints.length || 1
          : // Or just the current number of endpoints plus this one (the orphaned case)
            userProfile.numberOfEndpoints + 1,
        publicKeys: [
          ...userProfile.publicKeys,
          // Get all the public keys from the apps from this lb
          ...currentEndpointApps.map(
            (app) =>
              app?.freeTierApplicationAccount.publicKey ||
              app?.gatewayAAT.applicationPublicKey
          ),
        ],
        // We add the amount of individual apps this endpoint has (1 app = 1 pubkey)
        publicKeysPerEndpoint: [
          ...userProfile.publicKeysPerEndpoint,
          lb.applicationIDs.length,
        ],
      } as IUserProfile

      // Build the updated metric relay updates
      const newMetricUpdates = usageByChain.map((usagePerChain) => {
        totalUsageProcessed += usagePerChain.usage

        return {
          amount: usagePerChain.usage,
          chainID: usagePerChain.chain,
          endpointID: lb._id?.toString(),
          endpointName: lb.name,
          endpointPublicKeys: currentEndpointApps.map(
            (app) =>
              app?.freeTierApplicationAccount.publicKey ||
              app?.gatewayAAT.applicationPublicKey ||
              ''
          ),
        } as IRelayMetricUpdate
      })

      const updatedMetricUpdates = [...metricUpdates, ...newMetricUpdates]

      userProfiles.set(userKey, {
        userProfile: updatedUserProfile,
        metricUpdates: updatedMetricUpdates,
      })
    }
  }

  ctx.logger.info(`Processed ${totalUsageProcessed} usage`)

  return userProfiles
}

export async function sendRelayCountByEmail({
  userProfiles,
  ctx,
}: {
  userProfiles: Map<
    string,
    { userProfile: IUserProfile; metricUpdates: IRelayMetricUpdate[] }
  >
  ctx: any
}): Promise<void> {
  let totalUsage = 0
  const amplitudeClient = Amplitude.init(env('AMPLITUDE_API_KEY') as string)

  for (const [
    userID,
    { userProfile, metricUpdates },
  ] of userProfiles.entries()) {
    for (const metricUpdate of metricUpdates) {
      await amplitudeClient.logEvent({
        event_type: 'RELAY_METRIC_UPDATE',
        user_id: userID,
        event_properties: { ...metricUpdate },
        user_properties: {
          ...userProfile,
        },
      })
      totalUsage += metricUpdate.amount
    }
    await amplitudeClient.flush()
  }

  ctx.logger.info(
    `LOGGED ${userProfiles.size} users, with total usage ${totalUsage}`
  )
}

export async function registerAnalytics(ctx): Promise<void> {
  const apps = await fetchUsedApps(ctx)

  const userProfiles = await mapUsageToProfiles(apps, ctx)

  await sendRelayCountByEmail({
    ctx,
    userProfiles,
  })
}
