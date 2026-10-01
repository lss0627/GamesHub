import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gameConfigFromSpec } from '../apps/local-dev/src/real-unity';
import {
  buildDesignSpec,
  gameCapabilities,
  initialBrief,
} from '../packages/game-spec/src';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
async function main() {
  if (process.env.GAMERHUB_REAL_FLOW !== '1')
    throw new Error(
      'Set GAMERHUB_REAL_FLOW=1 for licensed Unity acceptance builds',
    );
  const editor = process.env.UNITY_EDITOR_PATH;
  if (!editor) throw new Error('UNITY_EDITOR_PATH_REQUIRED');
  const root = resolve('unity/Acceptance/GameplayExtensibility');
  const output = resolve('artifacts/gameplay-extensibility');
  await mkdir(output, { recursive: true });
  for (const name of ['Assets', 'Packages', 'ProjectSettings'])
    await cp(resolve('unity/Templates/Runner', name), join(root, name), {
      recursive: true,
      force: true,
    });
  await writeFile(
    join(root, 'Assets/Editor/AcceptanceBuild.cs'),
    `namespace GamerHub.Runner.Editor { public static class AcceptanceBuild { public static void Run() { RunnerSceneSetup.Ensure(); var type=System.Type.GetType("GamerHub.AgentBridge.Editor.BatchmodeMethods, GamerHub.AgentBridge.Editor"); if(type==null) throw new System.Exception("BUILD_BRIDGE_REQUIRED"); type.GetMethod("BuildWeb").Invoke(null,null); } } }`,
  );
  const selected = process.argv.slice(2);
  const profiles = gameCapabilities.filter(
    (p) => p.runtime && (!selected.length || selected.includes(p.genre)),
  );
  if (!profiles.length) throw new Error('PROFILE_REQUIRED');
  const previous = JSON.parse(
    await readFile(join(output, 'builds.json'), 'utf8').catch(() => '[]'),
  ) as Array<Record<string, unknown>>;
  const results = previous.filter(
    (result) => !profiles.some((profile) => profile.genre === result.genre),
  );
  for (const profile of profiles) {
    const spec = buildDesignSpec({
      ...initialBrief,
      genre: profile.genre,
      name: `${profile.name} · 蓝莓星球`,
      description: profile.instructions,
    });
    const config = gameConfigFromSpec(spec, `acceptance-${profile.genre}`);
    await writeFile(
      join(root, 'Assets/Resources/GamerHubGameConfig.json'),
      JSON.stringify(config),
    );
    await writeFile(
      join(output, `${profile.genre}-spec.json`),
      JSON.stringify(spec, null, 2),
    );
    const log = join(output, `${profile.genre}-build.log`);
    console.log(`BUILD ${profile.genre} started`);
    const child = spawn(
      editor,
      [
        '-batchmode',
        '-nographics',
        '-projectPath',
        root,
        '-logFile',
        log,
        '-executeMethod',
        'GamerHub.Runner.Editor.AcceptanceBuild.Run',
        '-gamerhub-outputPath',
        `Builds/Web/Presets/${profile.genre}`,
        '-quit',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('exit', done);
    });
    const content = await readFile(log, 'utf8');
    if (code !== 0 || !content.includes('"status":"succeeded"')) {
      console.log(
        content
          .split('\n')
          .filter((l) => /error CS|Exception|failed/i.test(l))
          .slice(-12)
          .join('\n'),
      );
      throw new Error(`BUILD_FAILED:${profile.genre}:${code}`);
    }
    const result = {
      genre: profile.genre,
      runtime: profile.runtime,
      root: join(root, 'Builds/Web/Presets', profile.genre),
      builtAt: new Date().toISOString(),
    };
    results.push(result);
    await writeFile(
      join(output, `${profile.genre}-build.json`),
      JSON.stringify(result, null, 2),
    );
    await writeFile(
      join(output, 'builds.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(`BUILD ${profile.genre} passed`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
