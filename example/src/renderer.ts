// Page script (plain <script>, no bundler). One line initializes BugSplat in this renderer.
const client = BugSplatElectron.init({ attributes: { page: 'index' } });

const statusEl = document.getElementById('status')!;
const logEl = document.getElementById('log')!;

function log(message: string): void {
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    logEl.prepend(line);
}

statusEl.textContent = `Electron ${window.demo.versions.electron} · Chromium ${window.demo.versions.chrome} · mode: ${client.mode} · database: ${client.database || '(none)'}`;

// A few frames so renderer stacks look like real application code.
function rendererFrame0(message: string): never {
    return rendererFrame1(message);
}
function rendererFrame1(message: string): never {
    return rendererFrame2(message);
}
function rendererFrame2(message: string): never {
    throw new Error(`BugSplat: ${message}`);
}

function hangFrame0(): void {
    hangFrame1();
}
function hangFrame1(): void {
    spinForever();
}
function spinForever(): void {
    let counter = 0;
    for (;;) {
        counter = (counter + 1) % 1_000_000;
    }
}

async function runRendererScenario(name: string): Promise<void> {
    log(`scenario: ${name}`);
    switch (name) {
        case 'renderer-throw':
            setTimeout(() => rendererFrame0('renderer-throw'), 10);
            return;
        case 'renderer-reject':
            void Promise.reject(new Error('BugSplat: renderer-reject'));
            return;
        case 'renderer-post': {
            const result = await client.post(new Error('BugSplat: manual post from renderer'), {
                attributes: { manual: 'true' },
            });
            log(result.error ? `post failed: ${result.error.message}` : 'posted from renderer');
            return;
        }
        case 'renderer-feedback': {
            const result = await client.postFeedback('Feedback from the example page', {
                description: 'BugSplat rocks!',
            });
            log(result.error ? `feedback failed: ${result.error.message}` : 'feedback posted');
            return;
        }
        case 'renderer-crash':
            window.demo.crashRenderer();
            return;
        case 'renderer-hang':
            // A long-running JavaScript loop: the kind of hang whose call stack Electron can collect.
            setTimeout(() => hangFrame0(), 10);
            return;
        case 'renderer-hang-native':
            // process.hang() spins in native code: no JavaScript runs, so no call stack is available.
            setTimeout(() => window.demo.hangRenderer(), 10);
            return;
        case 'renderer-oom': {
            const hoard: unknown[] = [];
            const allocateUntilOom = (): void => {
                for (;;) {
                    hoard.push(new Array(100_000).fill('bugsplat-oom'));
                }
            };
            setTimeout(allocateUntilOom, 10);
            return;
        }
        case 'identity-from-page': {
            client.setEmail('page@bugsplat.com');
            client.setAttribute('plan', 'pro');
            const result = await client.post(new Error('BugSplat: identity from page'));
            log(
                result.error ? `post failed: ${result.error.message}` : 'posted with page identity',
            );
            window.demo.crashRenderer();
            return;
        }
        default:
            log(await window.demo.run(name));
    }
}

window.demo.onScenario((name) => void runRendererScenario(name));

document.querySelectorAll<HTMLButtonElement>('button[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => void runRendererScenario(button.dataset.scenario!));
});

const identityForm = document.getElementById('identity') as HTMLFormElement;
identityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(identityForm);
    const user = String(data.get('user') ?? '');
    const email = String(data.get('email') ?? '');
    const appKey = String(data.get('appKey') ?? '');
    if (user) client.setUser(user);
    if (email) client.setEmail(email);
    if (appKey) client.setAppKey(appKey);
    log(`identity updated (user=${user || '-'}, email=${email || '-'}, key=${appKey || '-'})`);
});

client.onIdentity((identity) =>
    log(`identity from main: seq ${identity.seq}, email ${identity.email || '-'}`),
);
