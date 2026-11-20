import {
  OfflineEvaluations,
  EvaluationItem,
  EvaluationResult,
  EvaluationAPIError,
  ExperimentCreationAbortedError,
  BulkUploadError,
  type Scorer,
  type ScorerComposition,
  type ScorerCompositionInput,
  type ScorerInput,
  type ScorerCalculation,
  type ValidateCompositionOptions,
  type JSONValue,
} from '@posthog/ai/evaluations'

const client = new OfflineEvaluations({ projectId: 123, secretKey: 'secret', timeoutMs: 15000 })
const item = new EvaluationItem({ input: { question: 'Hello' }, output: null })
const result = new EvaluationResult({ item, scorerVersionId: 'uuid', value: false })
const calculation: ScorerCalculation = 'composite'
const input: ScorerCompositionInput = { alias: 'quality', scorerVersionId: 'uuid' }
const composition: ScorerComposition = { expression: 'quality * 2', inputs: [input] }
const validation: ValidateCompositionOptions = { kind: 'numeric', composition, config: { max: 2 } }
client.scorers.validateComposition(validation)
const calculated = new EvaluationResult({ item, scorerVersionId: 'uuid', calculate: true })
new EvaluationResult({ item, scorerVersionId: 'uuid', calculate: true, value: null, evaluatorTraceId: null })
// @ts-expect-error Calculations cannot include reported values.
new EvaluationResult({ item, scorerVersionId: 'uuid', calculate: true, value: false })
// @ts-expect-error Calculations cannot include payloads.
new EvaluationResult({ item, scorerVersionId: 'uuid', calculate: true, payload: {} })
// @ts-expect-error Calculations cannot include evaluator traces.
new EvaluationResult({ item, scorerVersionId: 'uuid', calculate: true, evaluatorTraceId: 'trace' })
// @ts-expect-error Calculations cannot specify error outcomes.
new EvaluationResult({ item, scorerVersionId: 'uuid', calculate: true, status: 'error' })
// @ts-expect-error Validation config must match its output kind.
client.scorers.validateComposition({ kind: 'boolean', composition, config: { min: 1 } })
const savedItem: string = item.toJSONString()
const savedResult: string = result.toJSONString()
EvaluationResult.fromJSON(JSON.parse(savedResult), { item: EvaluationItem.fromJSON(JSON.parse(savedItem)) })
new EvaluationResult({ item, scorerVersionId: 'uuid', status: 'error', errorMessage: 'Failure' })
new EvaluationResult({ item, scorerVersionId: 'uuid', status: 'skipped' })
new EvaluationResult({ item, scorerVersionId: 'uuid', value: 9007199254740992n })
// @ts-expect-error A successful outcome requires a value.
new EvaluationResult({ item, scorerVersionId: 'uuid' })
// @ts-expect-error Failed evaluations cannot carry scores.
new EvaluationResult({ item, scorerVersionId: 'uuid', status: 'error', value: 0 })
// @ts-expect-error Only error outcomes can carry non-null error messages.
new EvaluationResult({ item, scorerVersionId: 'uuid', value: true, payload: { errorMessage: 'bad' } })
// @ts-expect-error Payload and individual payload fields are mutually exclusive.
new EvaluationItem({ payload: {}, output: null })
// @ts-expect-error Arbitrary JSON payloads cannot contain bigint.
const invalidJSON: JSONValue = { count: 1n }
void invalidJSON
// @ts-expect-error Kind determines the scorer configuration.
client.scorers.create({ name: 'test', kind: 'boolean', config: { min: 1 } })
// @ts-expect-error Categorical options are required.
client.scorers.create({ name: 'test', kind: 'categorical', config: {} })
// @ts-expect-error Dataset input cannot be null.
client.datasets.createItem('uuid', { input: null })
// @ts-expect-error Item mutation requires an observed base version.
client.datasets.updateItem('uuid', { input: false })
// @ts-expect-error Dataset source provenance is immutable on updates.
client.datasets.updateItem('uuid', { baseVersion: 1, sourceOutput: 'new' })
async function examples(scorer: Scorer, error: unknown): Promise<void> {
  if (scorer.kind === 'categorical') scorer.config.options.map((o) => o.key)
  if (scorer.kind === 'numeric') scorer.config.passingRule?.threshold
  const numeric = await client.scorers.create({
    name: 'test',
    kind: 'numeric',
    config: { passingRule: { operator: 'gte', threshold: 0 } },
  })
  numeric.config.passingRule?.threshold
  const composite = await client.scorers.create({
    name: 'Combined',
    kind: 'numeric',
    config: {},
    calculation,
    composition,
  })
  await client.scorers.createVersion(composite.id, { config: {}, composition, baseVersion: composite.currentVersion })
  const inputs: ScorerInput[] = composite.inputScorers
  for (const input of inputs) if (input.kind === 'numeric') input.config.passingRule?.threshold
  const run = await client.createExperiment({ name: 'test', expectedItemCount: 9223372036854775807n })
  const receipt = await run.uploadResults([result, calculated])
  for (const chunk of receipt.chunks)
    for (const result of chunk.results) {
      if (result.status === 'error') result.errorCode?.toUpperCase()
    }
  await run.uploadResult({ item, scorerVersionId: composite.currentVersionId, calculate: true })
  const snapshot = await client.datasets.snapshot('uuid')
  for await (const row of snapshot) {
    await run.uploadResult({
      item: EvaluationItem.fromDatasetItem(row, { output: null }),
      scorerVersionId: numeric.currentVersionId,
      value: false,
    })
  }
  if (error instanceof EvaluationAPIError && error.submission) await client.createExperiment(error.submission)
  if (error instanceof ExperimentCreationAbortedError) {
    const cancellation: DOMException = error
    void cancellation
    await client.createExperiment(error.submission)
  }
  if (error instanceof BulkUploadError) await run.uploadResults(error.pendingResults)
}
void examples
client.close()
