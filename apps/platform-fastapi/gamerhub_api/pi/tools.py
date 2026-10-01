import asyncio
import hashlib
import os
import json
import re
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree

from .client import HIDDEN, PiError, terminate
from .registry import ToolRegistry, ToolSpec, bound_result


def development_id(action):
    task = action.get('input', {}).get('task', {})
    identifier = task.get('id', '').removeprefix('develop-')
    if (action.get('toolName') == 'unity.task.execute' and task.get('type') == 'script'
        and task.get('id') == f'develop-{identifier}' and re.fullmatch(r'[a-z][a-z0-9_]{1,40}', identifier)
        and 'gameplay.develop' in task.get('capabilities', [])
        and task.get('validation_method', {}).get('reference') == f'GamerHub.Generated.{identifier}Tests'):
        return identifier
    return None


def build_registry(action, handler, *, use_files=True):
    empty = {'type': 'object', 'properties': {}, 'additionalProperties': False}
    definitions = [{'name': 'execute_action', 'description': '执行当前已确认任务并返回真实验收结果。失败可修复游戏代码再重试。', 'parameters': empty}]
    if use_files:
        definitions += WorkspaceTools.definitions()
    definitions += [
        {'name': 'project_context', 'description': '读取本项目已确认制作说明、已完成任务与有效记忆。', 'parameters': empty},
        {'name': 'memory_search', 'description': '检索本项目用户明确记录的偏好和约束。', 'parameters': {'type': 'object', 'properties': {'query': {'type': 'string', 'maxLength': 200}}, 'required': ['query'], 'additionalProperties': False}},
    ]
    registry = ToolRegistry()
    for definition in definitions:
        name = definition['name']
        readonly = name in ('workspace_list', 'workspace_read', 'workspace_search', 'workspace_log', 'project_context', 'memory_search')
        phases = {'execute', 'repair'} if name == 'execute_action' else {'repair'}
        if development_id(action):
            phases.add('develop')
        registry.register(ToolSpec(**definition, phases=frozenset(phases),
            safety_class=action['safetyClass'] if name == 'execute_action' else 'read_only' if readonly else 'workspace_write',
            timeout_seconds=1900 if name == 'execute_action' else 310 if name == 'cli_run' else 30,
            max_output_bytes=32000 if name == 'workspace_read' else 12000,
            replay='safe' if readonly else 'never'), lambda args, name=name: handler(name, args))
    return registry


async def run_process(argv, cwd, *, timeout=180, log_path=None):
    env = {key: val for key, val in os.environ.items() if not any(word in key.upper() for word in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'DATABASE_URL'))}
    process = await asyncio.create_subprocess_exec(*argv, cwd=cwd, env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        **HIDDEN, **({'start_new_session': True} if os.name != 'nt' else {}))
    tail = bytearray()
    async def consume():
        while chunk := await process.stdout.read(4096):
            tail.extend(chunk)
            if len(tail) > 32000:
                del tail[:-32000]
        await process.wait()
    task = asyncio.create_task(consume())
    timed_out = False
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout)
    except TimeoutError:
        timed_out = True
        await terminate(process)
        await task
    except BaseException:
        await terminate(process)
        await task
        raise
    if log_path and log_path.exists():
        with log_path.open('rb') as source:
            source.seek(max(0, log_path.stat().st_size - 32000))
            tail = source.read()
    text = clean_output(bytes(tail).decode('utf8', errors='replace'), cwd)
    return {'exitCode': process.returncode, 'timedOut': timed_out, 'output': text}


def clean_output(text, root):
    for path, label in ((str(root), '<project>'), (os.getenv('USERPROFILE'), '<user>'), (os.getenv('UNITY_EDITOR_PATH'), '<unity-editor>')):
        if path:
            text = text.replace(path, label).replace(path.replace('\\', '/'), label)
    for key, value in os.environ.items():
        if len(value) >= 8 and any(word in key.upper() for word in ('API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'DATABASE_URL')):
            text = text.replace(value, '<redacted>')
    return text


class WorkspaceTools:
    def __init__(self, root, editor=None, *, test_paths=()):
        self.root = Path(root).resolve()
        self.editor = editor or os.getenv('UNITY_EDITOR_PATH')
        self.test_paths = {name for name in test_paths if re.fullmatch(r'Assets/Tests/PlayMode/Generated/[a-z][a-z0-9_]{1,40}Tests\.cs', name)}

    def path(self, name, write=False):
        value = Path(name)
        if value.is_absolute() or '..' in value.parts or ':' in name or '\\' in name:
            raise PiError('WORKSPACE_ESCAPE')
        cursor = self.root
        for part in value.parts:
            cursor = cursor / part
            if cursor.is_symlink() or (hasattr(cursor, 'is_junction') and cursor.is_junction()):
                raise PiError('WORKSPACE_ESCAPE')
        path = (self.root / value).resolve()
        if not path.is_relative_to(self.root):
            raise PiError('WORKSPACE_ESCAPE')
        allowed = name.startswith('Assets/Game/Scripts/') and name.endswith('.cs')
        allowed |= name in self.test_paths
        if not write:
            allowed |= name in ('Assets/Resources/GamerHubGameConfig.json', 'Assets/Resources/GamerHubCreative.json')
            allowed |= name.startswith('Assets/Tests/') and name.endswith('.cs')
        if not allowed:
            raise PiError('PATH_NOT_ALLOWED')
        return path

    @staticmethod
    def definitions():
        string = {'type': 'string'}
        def obj(properties, required):
            return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}
        return [
            {'name': 'workspace_list', 'description': '列出工程可访问的C#文件。目录含其他类型的模板，不需要逐个读取；先按任务列出的入口读取当前玩法。', 'parameters': obj({}, [])},
            {'name': 'workspace_read', 'description': '分页读取游戏脚本或配置，返回全文件hash与nextOffset；继续读取直到nextOffset为空后再修改。', 'parameters': obj({'path': string, 'offset': {'type': 'integer', 'minimum': 0}, 'limit': {'type': 'integer', 'minimum': 100, 'maximum': 8000}}, ['path'])},
            {'name': 'workspace_search', 'description': '在当前项目允许的C#脚本中查找文字，返回文件和行号。', 'parameters': obj({'query': {'type': 'string', 'minLength': 1, 'maxLength': 200}}, ['query'])},
            {'name': 'workspace_log', 'description': '按cli_run返回的logId分页读取本项目检查日志。', 'parameters': obj({'logId': {'type': 'string', 'pattern': '^[0-9a-f-]{36}$'}, 'offset': {'type': 'integer', 'minimum': 0}}, ['logId'])},
            {'name': 'workspace_write', 'description': '在读取原文件后按expectedHash写入游戏脚本；新文件expectedHash填空字符串。', 'parameters': obj({'path': string, 'content': string, 'expectedHash': string}, ['path', 'content', 'expectedHash'])},
            {'name': 'workspace_patch', 'description': '按expectedHash原子修改已读取的代码片段，保留文件其他字节。每个oldText必须在原文件唯一且彼此不重叠；任一不符则全部不写入。', 'parameters': obj({'path': string, 'expectedHash': string, 'edits': {'type': 'array', 'minItems': 1, 'maxItems': 20, 'items': obj({'oldText': {'type': 'string', 'minLength': 1, 'maxLength': 160000}, 'newText': {'type': 'string', 'maxLength': 160000}}, ['oldText', 'newText'])}}, ['path', 'expectedHash', 'edits'])},
            {'name': 'cli_run', 'description': '调用Unity CLI编译或PlayMode测试，失败诊断用于修复。', 'parameters': obj({'operation': {'enum': ['compile', 'test'], 'type': 'string'}, 'testFilter': string}, ['operation'])},
        ]

    async def call(self, name, args):
        if name == 'workspace_list':
            base = self.root / 'Assets/Game/Scripts'
            files = [str(p.relative_to(self.root)).replace('\\', '/') for folder in [base, self.root / 'Assets/Tests'] for p in folder.rglob('*.cs') if p.resolve().is_relative_to(self.root)]
            return {'files': sorted(files)[:200], 'writableTestPaths': sorted(self.test_paths)}
        if name == 'workspace_read':
            path = self.path(args['path'])
            if not path.is_file() or path.stat().st_size > 160000:
                raise PiError('FILE_UNAVAILABLE')
            raw = path.read_bytes()
            content = raw.decode('utf-8-sig')
            offset, limit = args.get('offset', 0), args.get('limit', 8000)
            return {'path': args['path'], 'content': content[offset:offset + limit], 'hash': hashlib.sha256(raw).hexdigest(),
                    'offset': offset, 'nextOffset': offset + limit if offset + limit < len(content) else None, 'totalCharacters': len(content)}
        if name == 'workspace_search':
            files = (await self.call('workspace_list', {}))['files']
            matches = []
            for relative in files:
                path = self.path(relative)
                if not path.is_file() or path.stat().st_size > 160000:
                    continue
                for line, text in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
                    if args['query'].lower() in text.lower():
                        matches.append({'path': relative, 'line': line, 'text': text[:180]})
                    if len(matches) >= 30:
                        return {'matches': matches, 'truncated': True}
            return {'matches': matches, 'truncated': False}
        if name == 'workspace_log':
            from uuid import UUID
            try:
                token = str(UUID(args['logId']))
            except ValueError:
                raise PiError('LOG_NOT_FOUND') from None
            path = (self.root / '.gamerhub-agent/logs' / f'{token}.log').resolve()
            if not path.is_relative_to(self.root) or not path.is_file():
                raise PiError('LOG_NOT_FOUND')
            offset = args.get('offset', 0)
            with path.open('rb') as source:
                source.seek(offset)
                raw = source.read(6000)
            return {'logId': token, 'output': clean_output(raw.decode('utf8', errors='replace'), self.root),
                    'offset': offset, 'nextOffset': offset + len(raw) if offset + len(raw) < path.stat().st_size else None}
        if name in ('workspace_write', 'workspace_patch'):
            path = self.path(args['path'], write=True)
            if path.exists() and (not path.is_file() or path.stat().st_size > 160000):
                raise PiError('FILE_UNAVAILABLE')
            raw = path.read_bytes() if path.exists() else b''
            expected = hashlib.sha256(raw).hexdigest() if path.exists() else ''
            if args.get('expectedHash') != expected:
                raise PiError('FILE_CHANGED')
            if name == 'workspace_patch':
                edits = args.get('edits')
                if not isinstance(edits, list) or not 1 <= len(edits) <= 20:
                    raise PiError('PATCH_EDITS_INVALID')
                spans = []
                for edit in edits:
                    if not isinstance(edit, dict) or not isinstance(edit.get('oldText'), str) or not edit['oldText'] or not isinstance(edit.get('newText'), str):
                        raise PiError('PATCH_EDITS_INVALID')
                    old, new = edit['oldText'].encode('utf8'), edit['newText'].encode('utf8')
                    start = raw.find(old)
                    if start < 0:
                        raise PiError('PATCH_TARGET_MISSING')
                    if raw.find(old, start + 1) >= 0:
                        raise PiError('PATCH_TARGET_AMBIGUOUS')
                    spans.append((start, start + len(old), new))
                spans.sort(key=lambda item: item[0])
                if any(first[1] > second[0] for first, second in zip(spans, spans[1:])):
                    raise PiError('PATCH_EDITS_OVERLAP')
                content = raw
                for start, end, new in reversed(spans):
                    content = content[:start] + new + content[end:]
            else:
                content = args['content'].encode('utf8')
            if len(content) > 160000:
                raise PiError('FILE_TOO_LARGE')
            # Private local backup before mutation; never expose host paths to model.
            backup = self.root / '.gamerhub-agent/backups' / f'{uuid4()}.cs'
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_bytes(raw)
            path.parent.mkdir(parents=True, exist_ok=True)
            staging = path.with_name(f'.{path.name}.{uuid4()}.agent-tmp')
            try:
                staging.write_bytes(content)
                self.path(args['path'], write=True)
                current = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ''
                if current != expected:
                    raise PiError('FILE_CHANGED')
                staging.replace(path)
            finally:
                staging.unlink(missing_ok=True)
            return {'path': args['path'], 'previousHash': expected, 'hash': hashlib.sha256(content).hexdigest(), 'bytes': len(content),
                    **({'editsApplied': len(spans)} if name == 'workspace_patch' else {})}
        if name == 'cli_run':
            op = args.get('operation')
            if op not in ('compile', 'test'):
                raise PiError('CLI_OPERATION_NOT_ALLOWED')
            if not self.editor or not Path(self.editor).is_file():
                raise PiError('UNITY_EDITOR_NOT_FOUND')
            folder = self.root / '.gamerhub-agent/logs'
            folder.mkdir(parents=True, exist_ok=True)
            token = str(uuid4())
            log, report = folder / f'{token}.log', folder / f'{token}.xml'
            argv = [self.editor, '-batchmode', '-nographics', '-projectPath', str(self.root), '-logFile', str(log)]
            if op == 'compile':
                argv += ['-quit']
            else:
                argv += ['-runTests', '-testPlatform', 'PlayMode', '-testResults', str(report)]
                if args.get('testFilter'):
                    argv += ['-testFilter', args['testFilter']]
            result = await run_process(argv, self.root, timeout=300, log_path=log)
            output = result['output']
            diagnostics = [line for line in output.splitlines() if 'error CS' in line or 'error:' in line.lower()]
            result['diagnostics'] = diagnostics[:30]
            result['logId'] = token
            if result['timedOut'] or result['exitCode'] != 0 or diagnostics:
                raise PiError('UNITY_CHECK_FAILED\n' + json.dumps(bound_result(result, 7000), ensure_ascii=False))
            if op == 'test':
                if not report.exists():
                    raise PiError('UNITY_TEST_REPORT_MISSING')
                xml = ElementTree.parse(report).getroot()
                result['tests'] = {key: xml.attrib.get(key) for key in ('passed', 'failed', 'total', 'result')}
                if int(xml.attrib.get('passed', '0')) < 1 or int(xml.attrib.get('failed', '0')):
                    raise PiError('UNITY_TESTS_FAILED_OR_EMPTY')
            return result
        raise PiError('TOOL_NOT_ALLOWED')
