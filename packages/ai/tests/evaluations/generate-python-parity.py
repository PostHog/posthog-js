"""Regenerate wire fixtures using an installed posthog-python checkout.

Usage: /path/to/posthog-python/.venv/bin/python generate-python-parity.py /path/to/posthog-python
No network requests are made. Commit the fixture so JS tests do not require Python.
"""
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
from posthog.ai.evaluations import OfflineEvaluations, EvaluationItem, EvaluationResult
from posthog.test.ai.test_evaluations import experiment_response, upload_response
from posthog.test.ai.test_evaluations_datasets import dataset_response, item_response, revision_response, page_response
from posthog.test.ai.test_evaluations_scorers import scorer_response, version_response

D = dataset_response()['id']
I = item_response()['id']
S = scorer_response()['id']
V = scorer_response()['current_version_id']
T = '2026-10-02T12:00:00.000Z'
E = S

def camel(key):
    first, *rest = key.split('_')
    return first + ''.join(x.title() for x in rest)

def options(kwargs):
    result = {camel(k): v for k, v in kwargs.items()}
    if 'config' in result:
        result['config'] = {camel(k): v for k, v in result['config'].items()}
    return result

client = OfflineEvaluations(project_id=123, secret_key='test-secret', max_retries=0)
# Managers and handles share this transport; replace only its request method.
transport = client._transport
captured = []
def case(resource, method, args, kwargs, response):
    transport.request = Mock(return_value=response)
    target = client if resource == 'client' else client.resume_experiment(E) if resource == 'experiment' else getattr(client, resource)
    getattr(target, method)(*args, **kwargs)
    call = transport.request.call_args
    request = {'method': call.args[0], 'path': call.args[1], 'params': call.kwargs.get('params', {}), 'retrySafe': call.kwargs.get('retry_safe', True)}
    if 'body' in call.kwargs:
        request['body'] = json.loads(call.kwargs['body'])
    js_args = list(args)
    if kwargs: js_args.append(options(kwargs))
    captured.append({'name': f'{resource}.{method}', 'resource': resource, 'method': camel(method), 'args': js_args, 'request': request, 'response': response})

case('client', 'create_experiment', (), dict(name='Regression', id=E, started_at=T, expected_item_count=0, expected_result_count=0, run_source=None, dataset_revision_id=dataset_response()['current_revision_id']), experiment_response())
for method, kwargs in [('create', dict(name='Cases', description='', metadata={}, tags=[' Regression '])), ('get', {}), ('list', dict(search='Cases', archived=False, tags=['Regression'], tag_match='all')), ('update', dict(description='', metadata={}, tags=[])), ('archive', {}), ('restore', {}), ('list_revisions', dict(limit=2, offset=1)), ('list_items', dict(revision=3, archived=False, limit=2, offset=1)), ('snapshot', {})]:
    args = () if method in ('create', 'list') else (D,)
    response = page_response(revision_response()) if method == 'list_revisions' else page_response(item_response()) if method == 'list_items' else page_response(dataset_response()) if method == 'list' else dataset_response()
    case('datasets', method, args, kwargs, response)
for method, args, kwargs, response in [
    ('create_item', (D,), dict(input=False, expected_output=0, source_output='', metadata={}, client_item_id='case-A', source_trace_id='source', source_event_id='event', source_timestamp=T), item_response()),
    ('get_item', (I,), dict(revision=3), item_response()),
    ('update_item', (I,), dict(base_version=2, expected_output=None, metadata={}), item_response()),
    ('archive_item', (I,), dict(base_version=2), item_response(archived=True)),
    ('restore_item', (I,), dict(base_version=3, source_version=1), item_response()),
    ('list_item_versions', (I,), dict(limit=2, offset=1), page_response(item_response())),
]: case('datasets', method, args, kwargs, response)
for scorer_kind, config in [
    ('boolean', {'true_is_failure': True, 'true_label': 'Failure', 'false_label': 'Pass'}),
    ('numeric', {'min': None, 'max': None, 'passing_rule': {'operator': 'gte', 'threshold': 0}}),
    ('categorical', {'options': [{'key': 'safe', 'label': 'Safe'}], 'selection_mode': 'multiple', 'passing_rule': {'categories': []}}),
]: case('scorers', 'create', (), dict(name='Quality', kind=scorer_kind, config=config, tags=[]), scorer_response(kind=scorer_kind, config=config))
for method, args, kwargs, response in [
    ('get', (S,), {}, scorer_response()),
    ('list', (), dict(limit=5, offset=2, search='Quality', kind='numeric', archived=False, order_by='-updated_at', tags=['Regression'], tag_match='all'), page_response(scorer_response())),
    ('update', (S,), dict(archived=False, description=None, tags=[]), scorer_response()),
    ('create_version', (S,), dict(config={'min': 0, 'passing_rule': {'operator': 'gte', 'threshold': 0}}, base_version=1, description=None), scorer_response()),
    ('get_version', (S, V), {}, version_response()),
    ('list_versions', (S,), dict(limit=2, cursor='opaque+cursor'), {'count': 1, 'results': [version_response()], 'next_cursor': None}),
]: case('scorers', method, args, kwargs, response)
for method, kwargs, response in [
    ('get_tags', {}, {'id': E, 'tags': ['regression']}),
    ('set_tags', {}, {'id': E, 'tags': ['regression']}),
    ('complete', {}, experiment_response(status='completed', finished_at=T)),
    ('fail', {}, experiment_response(status='failed', finished_at=T)),
]: case('experiment', method, ([' Regression ', 'regression'],) if method == 'set_tags' else (), kwargs, response)

local = []
for index, kwargs in enumerate([{}, {'payload': {}}, {'output': None}, {'input': False, 'output': 0, 'expected_output': '', 'metadata': {'user_key': [False, None, 'é😀']}}, {'case_key': 'case', 'trial': 'one', 'application_trace_id': 'trace'}]):
    kwargs['id'] = I
    declaration = EvaluationItem(**kwargs)
    local.append({'kind': 'item', 'options': options(kwargs), 'wire': declaration.to_dict()})
for kwargs in [{'value': False}, {'value': 0}, {'value': -1.25}, {'value': ['😀', '\ue000', 'a']}, {'status': 'error', 'error_code': 'timeout', 'error_message': None}, {'status': 'skipped'}, {'status': 'not_applicable'}, {'value': True, 'evaluated_at': '2026-10-02T14:00:00.123456+02:00'}]:
    kwargs = dict(item=I, scorer_version_id=V, **kwargs)
    declaration = EvaluationResult(**kwargs)
    local.append({'kind': 'result', 'options': options(kwargs), 'wire': declaration.to_dict()})
# Include a real Python-planned upload and its receipt.
item = EvaluationItem(id=I, input='question', output='answer')
result = EvaluationResult(item=item, scorer_version_id=V, value=False)
transport.request = Mock(side_effect=lambda method, path, **kwargs: upload_response(kwargs['body']))
client.resume_experiment(E).upload_results([result])
call = transport.request.call_args
upload = {'body': json.loads(call.kwargs['body']), 'response': upload_response(call.kwargs['body'])}
client.close()
output = {'pythonRevision': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(), 'cases': captured, 'declarations': local, 'upload': upload}
Path(__file__).with_name('python-parity.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
