// نشر نسخة جديدة من برنامج الويندوز للعملاء (التحديث التلقائي بيوصلهم من هنا):
//   من فولدر المشروع:  npm run desktop:release -- 1.0.1
// الخطوات: يغيّر رقم النسخة ← يبني الواجهة والبرنامج ← يرفع ملف التسطيب و latest.yml على
// GitHub Releases في مستودع ZeyadKhaled19/erp-releases (لازم GitHub CLI متسطب ومسجّل دخول: gh auth login).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const pkgFile = path.join(desktop, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
const target = pkg.build.publish?.[0];
if (!target?.owner || !target?.repo) throw new Error('مكان النشر مش متحدد في desktop/package.json (build.publish)');
const repo = `${target.owner}/${target.repo}`;

const version = process.argv[2] || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`رقم نسخة غير صالح: ${version} (المفروض زي 1.0.1)`);

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
const gh = (args) => execFileSync('gh', args, { cwd: desktop, encoding: 'utf8', shell: process.platform === 'win32' }).trim();

// لازم gh يكون شغال قبل ما نضيع وقت في البناء
try {
  gh(['auth', 'status']);
} catch {
  throw new Error('GitHub CLI مش مسجّل دخول. شغّل:  gh auth login');
}
let exists = false;
try {
  gh(['release', 'view', `v${version}`, '--repo', repo]);
  exists = true;
} catch { /* مش موجودة: تمام */ }
if (exists) throw new Error(`النسخة v${version} منشورة قبل كده — اختار رقم أكبر`);

if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`رقم النسخة بقى ${version}`);
}

console.log('\n== بناء الواجهة');
run('npm', ['run', 'build']);
console.log('\n== بناء البرنامج وملف التسطيب');
run('npm', ['run', 'prepare-app'], desktop);
run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'], desktop);

const rel = path.join(desktop, 'release');
const exe = path.join(rel, `ERP-Setup-${version}.exe`);
const files = [exe, `${exe}.blockmap`, path.join(rel, 'latest.yml')];
for (const f of files) if (!existsSync(f)) throw new Error(`ملف ناقص بعد البناء: ${f}`);

console.log(`\n== نشر v${version} على ${repo}`);
gh(['release', 'create', `v${version}`, ...files, '--repo', repo, '--title', `${pkg.productName} ${version}`, '--notes', `تحديث ${version}`, '--latest']);
console.log(`\n✓ النسخة ${version} اتنشرت. البرامج المتسطّبة عند العملاء هتلاقيها لوحدها خلال 4 ساعات أو أول ما تتفتح.`);
console.log('  متنساش: اعمل commit لرقم النسخة الجديد في desktop/package.json');
