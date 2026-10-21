import {
  OfflineEvaluations,
  EvaluationItem,
  EvaluationResult,
  EvaluationAPIError,
  ExperimentCreationAbortedError,
  BulkUploadError,
  type Scorer,
  type JSONValue,
} from '@posthog/ai/evaluations'

const client = new OfflineEvaluations({ projectId: 123, secretKey: 'secret', timeoutMs: 15000 })
const item = new EvaluationItem({ input: { question: 'Hello' }, output: null })
new EvaluationResult({ item, scorerVersionId: 'uuid', value: false })
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
  const run = await client.createExperiment({ name: 'test', expectedItemCount: 9223372036854775807n })
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
