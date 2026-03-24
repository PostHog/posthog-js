import type { BundleTypes } from './module.slim.es'
import * as bundles from '../extensions/extension-bundles'
export const AllExtensions = bundles.AllExtensions as typeof BundleTypes.AllExtensions
export const FeatureFlagsExtensions = bundles.FeatureFlagsExtensions as typeof BundleTypes.FeatureFlagsExtensions
export const SessionReplayExtensions = bundles.SessionReplayExtensions as typeof BundleTypes.SessionReplayExtensions
export const AnalyticsExtensions = bundles.AnalyticsExtensions as typeof BundleTypes.AnalyticsExtensions
export const ErrorTrackingExtensions = bundles.ErrorTrackingExtensions as typeof BundleTypes.ErrorTrackingExtensions
export const ProductToursExtensions = bundles.ProductToursExtensions as typeof BundleTypes.ProductToursExtensions
export const SiteAppsExtensions = bundles.SiteAppsExtensions as typeof BundleTypes.SiteAppsExtensions
export const SurveysExtensions = bundles.SurveysExtensions as typeof BundleTypes.SurveysExtensions
export const TracingExtensions = bundles.TracingExtensions as typeof BundleTypes.TracingExtensions
export const ToolbarExtensions = bundles.ToolbarExtensions as typeof BundleTypes.ToolbarExtensions
export const ExperimentsExtensions = bundles.ExperimentsExtensions as typeof BundleTypes.ExperimentsExtensions
export const ConversationsExtensions = bundles.ConversationsExtensions as typeof BundleTypes.ConversationsExtensions
export const LogsExtensions = bundles.LogsExtensions as typeof BundleTypes.LogsExtensions
