// Builds the profile's living art from real account data (public + private).
// Usage: GH_TOKEN=... node scripts/generate.mjs   (needs a token with `repo` scope to see private work)
import { writeFileSync, mkdirSync } from 'node:fs';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GH_TOKEN missing');

const gql = async (query, variables = {}) => {
    const r = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-art' },
        body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
};

// ---------- data ----------
const base = await gql(`{
  viewer {
    login createdAt
    repositories(ownerAffiliations: OWNER, first: 100, isFork: false) {
      totalCount
      nodes { isPrivate stargazerCount languages(first: 8, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name } } } }
    }
    pullRequests { totalCount }
    contributionsCollection {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } }
    }
  }
}`);
const v = base.viewer;

// lifetime commits, year by year (private commits included via restrictedContributionsCount)
let commits = 0;
for (let y = new Date(v.createdAt).getUTCFullYear(); y <= new Date().getUTCFullYear(); y++) {
    const d = await gql(
        `query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) { totalCommitContributions restrictedContributionsCount } } }`,
        { from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` },
    );
    const c = d.viewer.contributionsCollection;
    commits += c.totalCommitContributions + c.restrictedContributionsCount;
}

const repos = v.repositories.nodes;
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);
const privateCount = repos.filter((r) => r.isPrivate).length;
const langBytes = {};
repos.forEach((r) => r.languages.edges.forEach((e) => { langBytes[e.node.name] = (langBytes[e.node.name] || 0) + e.size; }));
const langTotal = Object.values(langBytes).reduce((a, b) => a + b, 0);
const langs = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, b]) => ({ name, pct: (b / langTotal) * 100 }));

const cal = v.contributionsCollection.contributionCalendar;
const weeks = cal.weeks;

// ---------- shared look ----------
const BG = '#0f2a22';
const STYLE_BASE = `
  text { font-family: Georgia, 'Times New Roman', serif; }
  .t  { font-size: 15px; font-style: italic; fill: #b9d3b4; letter-spacing: .5px; }
  .n  { font-size: 34px; font-weight: 300; fill: #eaf3e4; }
  .l  { font-size: 13px; fill: #8fb08e; letter-spacing: 1px; }
  .fi { opacity: 0; animation: fi 1.4s ease-out forwards; }
  @keyframes fi { to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; opacity: 1 !important; } }`;
const LEVEL = { NONE: null, FIRST_QUARTILE: ['#5f9a62', 0.62], SECOND_QUARTILE: ['#86b97a', 0.78], THIRD_QUARTILE: ['#b7d99a', 0.95], FOURTH_QUARTILE: ['#e3f2c8', 1.15] };
const fmt = (n) => n.toLocaleString('en-US');
mkdirSync('assets', { recursive: true });

// ---------- 1. the garden: every day you built something becomes a leaf ----------
{
    const P = 16, X0 = 28, Y0 = 62, W = 900, H = 205;
    let leaves = '';
    let rnd = 7;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    weeks.forEach((w, wi) => w.contributionDays.forEach((d, di) => {
        const x = X0 + wi * P, y = Y0 + di * P;
        const lv = LEVEL[d.contributionLevel];
        if (!lv) { leaves += `<circle cx="${x}" cy="${y}" r="1.1" fill="#2c5a47"/>`; return; }
        const rot = Math.round(-70 + rand() * 140);
        const sway = (3.2 + rand() * 2.4).toFixed(1);
        const delay = (rand() * 4).toFixed(2);
        leaves += `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${lv[1]})"><g class="sw" style="animation-duration:${sway}s;animation-delay:-${delay}s"><use href="#lf" fill="${lv[0]}"/></g></g>`;
    }));
    // a few leaves letting go and drifting down, quietly
    let drift = '';
    for (let i = 0; i < 5; i++) {
        const x = 120 + i * 170 + Math.round(rand() * 40);
        drift += `<g transform="translate(${x} 40)"><g class="dr" style="animation-delay:-${i * 3.1}s"><use href="#lf" fill="#b7d99a" transform="scale(.9)"/></g></g>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${fmt(cal.totalContributions)} contributions in the last year, drawn as leaves">
<defs><path id="lf" d="M0,-6 C5,-4 6,2 0,7 C-6,2 -5,-4 0,-6 Z"/>
<style>${STYLE_BASE}
.sw { transform-box: fill-box; transform-origin: 50% 90%; animation: sw 4s ease-in-out infinite; }
@keyframes sw { 0%,100% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }
.dr { animation: dr 15s linear infinite; opacity: 0; }
@keyframes dr { 0% { transform: translate(0,0) rotate(0); opacity: 0; } 10% { opacity: .8; } 70% { opacity: .8; } 100% { transform: translate(-40px,150px) rotate(200deg); opacity: 0; } }
</style></defs>
<rect width="${W}" height="${H}" rx="14" fill="${BG}"/>
<text class="t" x="28" y="34">the garden. ${fmt(cal.totalContributions)} things done this year, public and private, each one a leaf.</text>
${drift}${leaves}
</svg>`;
    writeFileSync('assets/garden.svg', svg);
}

// ---------- 2. numbers, quietly ----------
{
    const items = [
        [fmt(commits), 'commits, all time'],
        [fmt(repos.length), `repos (${privateCount} private)`],
        [fmt(v.pullRequests.totalCount), 'pull requests'],
        [fmt(stars), 'stars'],
    ];
    const W = 900, H = 140, cw = (W - 56) / items.length;
    const cells = items.map(([n, l], i) => {
        const x = 28 + i * cw;
        return `<g class="fi" style="animation-delay:${0.25 * i}s"><text class="n" x="${x}" y="72">${n}</text><text class="l" x="${x}" y="96">${l.toUpperCase()}</text><line x1="${x}" y1="108" x2="${x + 46}" y2="108" stroke="#5f9a62" stroke-width="1.5"/></g>`;
    }).join('');
    writeFileSync('assets/stats.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lifetime numbers">
<style>${STYLE_BASE}</style><rect width="${W}" height="${H}" rx="14" fill="${BG}"/>
<text class="t" x="28" y="30">in numbers, counting what you cannot see too</text>${cells}</svg>`);
}

// ---------- 3. what the hands reach for ----------
{
    const W = 900, H = 150, BX = 28, BW = W - 56;
    const shades = ['#e3f2c8', '#b7d99a', '#86b97a', '#5f9a62', '#417a52', '#2f5f46'];
    const sum = langs.reduce((a, b) => a + b.pct, 0);
    let x = BX, bars = '', legend = '';
    langs.forEach((l, i) => {
        const w = Math.max(6, (l.pct / sum) * BW);
        bars += `<rect x="${x.toFixed(1)}" y="52" height="14" width="${w.toFixed(1)}" fill="${shades[i]}" class="fi" style="animation-delay:${0.15 * i}s"/>`;
        const lx = BX + (i % 3) * 290, ly = 98 + Math.floor(i / 3) * 24;
        legend += `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${shades[i]}"/><text class="l" x="${lx + 18}" y="${ly}">${l.name.toUpperCase()}  ${l.pct.toFixed(1)}%</text>`;
        x += w;
    });
    writeFileSync('assets/langs.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Languages across public and private repos">
<defs><clipPath id="c"><rect x="${BX}" y="52" width="${BW}" height="14" rx="7"/></clipPath><style>${STYLE_BASE}</style></defs>
<rect width="${W}" height="${H}" rx="14" fill="${BG}"/>
<text class="t" x="28" y="30">what the hands reach for</text>
<g clip-path="url(#c)">${bars}</g>${legend}</svg>`);
}

console.log({ commits, repos: repos.length, privateCount, stars, langs: langs.map((l) => `${l.name} ${l.pct.toFixed(1)}`), days: cal.totalContributions });
