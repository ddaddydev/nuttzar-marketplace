// bot/tornLevelList.js
// Baldr levelling target list — static, no API calls needed

const LEVEL_LIST_CHANNEL_ID = '1482548695584215181';

const TARGETS = [
  // Nic's additions
  { name:'imaginarytruths',  id:2670154, lvl:100, total:200  },
  { name:'cockynudist',      id:2209950, lvl:100, total:200  },
  // Baldr List 1
  { name:'crazydave',        id:320161,  lvl:35,  total:990  },
  { name:'maverick1972',     id:522960,  lvl:31,  total:396  },
  { name:'Mataifa',          id:488552,  lvl:31,  total:640  },
  { name:'fanpi017',         id:810355,  lvl:30,  total:654  },
  { name:'OwlByNite',        id:1046495, lvl:29,  total:450  },
  { name:'Luciii',           id:524912,  lvl:28,  total:579  },
  { name:'-----Nick----',    id:1682111, lvl:28,  total:638  },
  { name:'russellkill',      id:387822,  lvl:28,  total:763  },
  { name:'themastercheif',   id:566484,  lvl:27,  total:119  },
  { name:'matt007',          id:298167,  lvl:27,  total:194  },
  { name:'babymolly',        id:879148,  lvl:27,  total:227  },
  { name:'Dragon_Reborn',    id:234429,  lvl:27,  total:470  },
  { name:'Sachmo',           id:428732,  lvl:27,  total:580  },
  { name:'tapper85',         id:18798,   lvl:27,  total:582  },
  { name:'james2503',        id:476620,  lvl:26,  total:129  },
  { name:'iBennett',         id:472351,  lvl:26,  total:131  },
  { name:'wilash',           id:807823,  lvl:26,  total:134  },
  { name:'nathwin',          id:1379450, lvl:26,  total:249  },
  { name:'raysil',           id:796316,  lvl:26,  total:314  },
  { name:'ilekilluall8',     id:316768,  lvl:26,  total:335  },
  { name:'soldierx',         id:153910,  lvl:26,  total:350  },
  { name:'DevilsBlood',      id:76096,   lvl:26,  total:371  },
  { name:'mikeycallin1',     id:659852,  lvl:26,  total:415  },
  { name:'warriorscode',     id:738073,  lvl:26,  total:445  },
  { name:'whiteshadow',      id:284536,  lvl:26,  total:509  },
  { name:'halfblood93',      id:263120,  lvl:26,  total:805  },
  { name:'fortunecookie',    id:729174,  lvl:26,  total:897  },
  { name:'Aceraven',         id:1489357, lvl:25,  total:221  },
  { name:'Boylinger',        id:669996,  lvl:25,  total:264  },
  { name:'nemesis2000',      id:191060,  lvl:25,  total:294  },
  { name:'heva07',           id:454302,  lvl:25,  total:333  },
  { name:'Bob_the_butler',   id:1199189, lvl:25,  total:423  },
  { name:'ckirklin',         id:485156,  lvl:25,  total:453  },
  { name:'theking99218',     id:1399310, lvl:25,  total:468  },
  { name:'srfshannon',       id:581300,  lvl:25,  total:475  },
  { name:'andre_xavier',     id:211286,  lvl:25,  total:561  },
  { name:'CasterZ',          id:469582,  lvl:25,  total:622  },
  { name:'-Diablo-',         id:652354,  lvl:25,  total:640  },
  { name:'xZULUx',           id:781161,  lvl:25,  total:648  },
  { name:'indo',             id:491724,  lvl:25,  total:716  },
  { name:'kracker65',        id:233040,  lvl:25,  total:719  },
  { name:'terrence_taylor',  id:688148,  lvl:25,  total:824  },
  { name:'Man-u-4-Life',     id:442427,  lvl:25,  total:846  },
  { name:'Morphine2man',     id:588113,  lvl:25,  total:916  },
  { name:'PRlNCE',           id:669588,  lvl:25,  total:970  },
  // Baldr List 2
  { name:'agreaves',         id:1265642, lvl:24,  total:90   },
  { name:'killatrone_4000',  id:861978,  lvl:24,  total:155  },
  { name:'natashamarie',     id:993561,  lvl:24,  total:177  },
  { name:'lordzenn',         id:475911,  lvl:24,  total:197  },
  { name:'xVx-Assassin',    id:853558,  lvl:24,  total:207  },
  { name:'transvaaler',      id:1199867, lvl:24,  total:226  },
  { name:'-SasukeUchiha-',   id:556637,  lvl:24,  total:235  },
  { name:'mroq',             id:318410,  lvl:24,  total:279  },
  { name:'dj95',             id:646007,  lvl:24,  total:285  },
  { name:'AnnabellLee',      id:627612,  lvl:24,  total:293  },
  { name:'DJJR',             id:719349,  lvl:24,  total:330  },
  { name:'jackiboi2k8',      id:969920,  lvl:24,  total:333  },
  { name:'JoeCool555',       id:656275,  lvl:24,  total:342  },
  { name:'sidmire',          id:178235,  lvl:24,  total:351  },
  { name:'silverwings19',    id:587991,  lvl:24,  total:363  },
  { name:'lowlaynsten',      id:586812,  lvl:24,  total:368  },
  { name:'evil-one',         id:590277,  lvl:24,  total:395  },
  { name:'LilPimpinjr',      id:44940,   lvl:24,  total:406  },
  { name:'killer133',        id:983314,  lvl:24,  total:411  },
  { name:'cascao',           id:888467,  lvl:24,  total:428  },
  { name:'xXDannyBoiiXx',   id:567611,  lvl:24,  total:436  },
  { name:'artsmart020',      id:1306114, lvl:24,  total:442  },
  { name:'Darkstar123',      id:1269587, lvl:24,  total:445  },
  { name:'Slim_JIM',         id:782249,  lvl:24,  total:521  },
  { name:'Demon_Lizzard',    id:56712,   lvl:24,  total:565  },
  { name:'kicks',            id:383473,  lvl:24,  total:621  },
  { name:'determanator',     id:894205,  lvl:24,  total:634  },
  { name:'Rurouni',          id:1016568, lvl:24,  total:645  },
  { name:'Ibrahim1250',      id:874491,  lvl:24,  total:685  },
  { name:'CrayolaCrackers',  id:481648,  lvl:24,  total:694  },
  { name:'DonMc94',          id:1032025, lvl:24,  total:738  },
  { name:'--KW--DARk',       id:246649,  lvl:24,  total:738  },
  { name:'loppolman',        id:443421,  lvl:24,  total:796  },
  { name:'peacefrog',        id:194310,  lvl:24,  total:796  },
  { name:'MrBensyBen94',     id:573258,  lvl:24,  total:808  },
  { name:'soldier27',        id:104318,  lvl:24,  total:815  },
  { name:'doggydog10',       id:1011379, lvl:24,  total:854  },
  { name:'siurblys',         id:33084,   lvl:24,  total:895  },
  { name:'dragonman101',     id:1387230, lvl:24,  total:966  },
  { name:'yaesu001',         id:353299,  lvl:23,  total:126  },
  { name:'Dragon721',        id:542048,  lvl:23,  total:161  },
  { name:'Monica',           id:659243,  lvl:23,  total:290  },
  { name:'mzwpunk',          id:1104804, lvl:23,  total:392  },
  { name:'maxrocks',         id:352232,  lvl:23,  total:403  },
  { name:'4fingers',         id:670186,  lvl:23,  total:463  },
  { name:'knucles777',       id:448387,  lvl:23,  total:857  },
  { name:'ministerdeadman',  id:441061,  lvl:23,  total:976  },
  { name:'nuryn',            id:652570,  lvl:22,  total:268  },
  { name:'K00L-',            id:693146,  lvl:22,  total:285  },
  { name:'scottywalker',     id:595042,  lvl:22,  total:432  },
  { name:'63476',            id:63476,   lvl:22,  total:457  },
  { name:'HatchetWarrior',   id:508876,  lvl:22,  total:594  },
  { name:'Pandemic',         id:640180,  lvl:22,  total:631  },
  { name:'kaungkaung3887',   id:1390755, lvl:22,  total:701  },
  { name:'hotrod',           id:104247,  lvl:22,  total:940  },
  { name:'green_punk768',    id:534510,  lvl:21,  total:108  },
  { name:'Miff99',           id:507739,  lvl:21,  total:159  },
  { name:'CdWilliams101',    id:172402,  lvl:21,  total:257  },
  { name:'Adam12321',        id:508367,  lvl:21,  total:299  },
  { name:'Misspriss',        id:456008,  lvl:21,  total:323  },
  { name:'RockinGamer',      id:591855,  lvl:21,  total:331  },
  { name:'phyzco',           id:247701,  lvl:21,  total:390  },
  { name:'34tiger',          id:470393,  lvl:21,  total:518  },
  { name:'Adrian1221',       id:471778,  lvl:21,  total:543  },
  { name:'323695',           id:323695,  lvl:21,  total:638  },
  // Baldr List 3
  { name:'livehere',         id:969780,  lvl:20,  total:80   },
  { name:'tutan',            id:1389629, lvl:20,  total:89   },
  { name:'samartin',         id:685929,  lvl:20,  total:90   },
  { name:'fredie',           id:524902,  lvl:20,  total:98   },
  { name:'Hass101',          id:974933,  lvl:20,  total:99   },
  { name:'sLiPkNoTbOy',     id:497977,  lvl:20,  total:106  },
  { name:'joshymitty',       id:1022737, lvl:20,  total:107  },
  { name:'tnm021',           id:794755,  lvl:20,  total:111  },
  { name:'nickp36',          id:1171459, lvl:20,  total:114  },
  { name:'hisham654',        id:422145,  lvl:20,  total:117  },
  { name:'slykid',           id:581343,  lvl:20,  total:126  },
  { name:'fredmonkey',       id:648698,  lvl:20,  total:128  },
  { name:'bighorse',         id:857866,  lvl:20,  total:134  },
  { name:'MRFoxtrot',        id:849660,  lvl:20,  total:146  },
  { name:'qwertypoo',        id:313327,  lvl:20,  total:147  },
  { name:'Jonny4toes',       id:512249,  lvl:20,  total:149  },
  { name:'CHRIS382',         id:904225,  lvl:20,  total:157  },
  { name:'When7Meets7',      id:342880,  lvl:20,  total:181  },
  { name:'omoroxs',          id:1101484, lvl:20,  total:184  },
  { name:'Joshuaaare',       id:582138,  lvl:20,  total:189  },
  { name:'Marine2015',       id:790460,  lvl:20,  total:197  },
  { name:'wayneker',         id:525298,  lvl:20,  total:218  },
  { name:'mavinny',          id:677104,  lvl:20,  total:221  },
  { name:'mrman',            id:580371,  lvl:20,  total:222  },
  { name:'ken-XXX',          id:921628,  lvl:20,  total:230  },
  { name:'nature95boy',      id:894666,  lvl:20,  total:247  },
  { name:'smw23',            id:1413853, lvl:20,  total:266  },
  { name:'shaun103',         id:693966,  lvl:20,  total:266  },
  { name:'weerossy',         id:579753,  lvl:20,  total:268  },
  { name:'Mattyea',          id:428350,  lvl:20,  total:277  },
  { name:'Richev12',         id:982909,  lvl:20,  total:279  },
  { name:'leeroydon',        id:671763,  lvl:20,  total:282  },
  { name:'Pyrogod',          id:678613,  lvl:20,  total:294  },
  { name:'Mijumaru',         id:238623,  lvl:20,  total:323  },
  { name:'hoangnhu',         id:469387,  lvl:20,  total:326  },
  { name:'Nikon',            id:96674,   lvl:20,  total:340  },
  { name:'omgitswill',       id:298602,  lvl:20,  total:355  },
  { name:'guppy12345',       id:490998,  lvl:20,  total:385  },
  { name:'SEXYPERSON101',    id:916404,  lvl:20,  total:403  },
  { name:'pimpin',           id:577479,  lvl:20,  total:419  },
  { name:'melinko',          id:323067,  lvl:20,  total:440  },
  { name:'lucy1011',         id:1073189, lvl:20,  total:445  },
  { name:'zapman119',        id:239449,  lvl:20,  total:451  },
  { name:'ptownboi04',       id:509029,  lvl:20,  total:482  },
  { name:'kashmoney',        id:938020,  lvl:20,  total:494  },
  { name:'AngelOfHealing',   id:331666,  lvl:20,  total:501  },
  { name:'blood2433',        id:1306189, lvl:20,  total:501  },
  { name:'Mr_Sosa',          id:1151368, lvl:20,  total:531  },
  { name:'jackwatkins',      id:640201,  lvl:20,  total:565  },
  { name:'mic1000',          id:999990,  lvl:20,  total:588  },
  { name:'RedArmy92',        id:956400,  lvl:20,  total:590  },
  { name:'JBauer',           id:295976,  lvl:20,  total:632  },
  { name:'RamboX',           id:424049,  lvl:20,  total:649  },
  { name:'smantas',          id:848845,  lvl:20,  total:668  },
  { name:'1Wonder',          id:1003142, lvl:20,  total:696  },
  { name:'Michelle_Gurl',    id:257120,  lvl:20,  total:781  },
  { name:'LordDragon',       id:279869,  lvl:20,  total:790  },
  { name:'warfarescare',     id:1011214, lvl:20,  total:793  },
  { name:'jesse_c',          id:865088,  lvl:20,  total:850  },
  { name:'Firestar952',      id:774785,  lvl:20,  total:889  },
  { name:'Mossy',            id:734208,  lvl:20,  total:898  },
  { name:'balbaro',          id:782638,  lvl:20,  total:912  },
  { name:'lordjamman',       id:512111,  lvl:20,  total:923  },
  { name:'aaronyuan',        id:901426,  lvl:19,  total:54   },
  { name:'gogo234',          id:1423394, lvl:19,  total:67   },
  { name:'dmora',            id:1075217, lvl:19,  total:82   },
  { name:'dick646',          id:870109,  lvl:19,  total:136  },
  { name:'forgotten_mists',  id:296249,  lvl:19,  total:174  },
  { name:'dillin1333',       id:1183664, lvl:19,  total:187  },
  { name:'Frozenmalice',     id:789256,  lvl:19,  total:206  },
  { name:'dannieex',         id:430140,  lvl:19,  total:213  },
  { name:'Febreeze',         id:935251,  lvl:19,  total:246  },
  { name:'Foxy-Roxy04',      id:1169008, lvl:19,  total:253  },
  { name:'cooterjessie',     id:367428,  lvl:19,  total:296  },
  { name:'DarthZannah',      id:555271,  lvl:19,  total:351  },
  { name:'djyoda',           id:750371,  lvl:19,  total:412  },
  { name:'-007',             id:1380052, lvl:19,  total:599  },
  { name:'beggerboy',        id:477364,  lvl:19,  total:729  },
  { name:'casper619',        id:1442848, lvl:19,  total:912  },
  { name:'Braskius',         id:430622,  lvl:17,  total:113  },
  { name:'fathead',          id:1394290, lvl:17,  total:217  },
  { name:'Footballman12',    id:552906,  lvl:15,  total:451  },
  { name:'AbcDragonMaster',  id:91892,   lvl:15,  total:552  },
  { name:'Deathreaper123',   id:849274,  lvl:14,  total:635  },
  // Domino Effect list
  { name:'DonEdweezy',       id:943004,  lvl:38,  total:2356,   domino:true },
  { name:'faheemd',          id:1978001, lvl:20,  total:861,    domino:true },
  { name:'HappyStore',       id:2150020, lvl:20,  total:987,    domino:true },
  { name:'Beasto',           id:1893007, lvl:16,  total:407,    domino:true },
  { name:'oOLawrenceOo',     id:1747935, lvl:15,  total:318,    domino:true },
  { name:'Ghoad',            id:2061354, lvl:8,   total:172,    domino:true },
  { name:'fijimarie',        id:1964175, lvl:8,   total:479,    domino:true },
  { name:'L3MILK',           id:1999595, lvl:4,   total:99,     domino:true },
  { name:'DOMINODOM',        id:1776074, lvl:3,   total:164,    domino:true },
  // Semper Fortis / Manu Forti / Vae Victis
  { name:'penguinbob',       id:1636674, lvl:5,   total:2765275, semper:true },
];


const axios = require('axios');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Hospital check — called on demand by /checkhospital ───────────────────────
async function checkHospitalStatus(apiKey) {
  const results = { hosped: [], available: [], errors: 0 };
  const now = Math.floor(Date.now() / 1000);
  const ids = TARGETS.filter(t => !t.semper).map(t => t.id); // skip penguinbob etc

  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    await Promise.all(batch.map(async id => {
      try {
        const res = await axios.get(
          `https://api.torn.com/user/${id}?selections=basic&key=${apiKey}&comment=NuttHub`,
          { timeout: 8000 }
        );
        if (res.data?.error) { results.errors++; return; }
        const s = res.data?.status;
        const target = TARGETS.find(t => t.id === id);
        if (!s || !target) return;
        if (s.state === 'Hospital' && s.until > now) {
          results.hosped.push({ ...target, until: s.until });
        } else {
          results.available.push(target);
        }
      } catch { results.errors++; }
    }));
    if (i + 5 < ids.length) await delay(4000); // 5 req/4s ≈ 45 req/min
  }

  results.hosped.sort((a, b) => a.until - b.until);
  return results;
}

function fmtCountdown(untilTs) {
  const secs = Math.max(0, untilTs - Math.floor(Date.now() / 1000));
  if (!secs) return 'Out now';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

function buildHospitalEmbeds(results, checkedBy) {
  const embeds = [];
  const ts = `<t:${Math.floor(Date.now()/1000)}:R>`;

  if (!results.hosped.length) {
    embeds.push({
      color: 0x2ECC71,
      title: '🏥 Hospital Check — All Clear',
      description: `No targets currently in hospital.

Checked **${results.available.length}** targets${results.errors ? ` (${results.errors} errors)` : ''}.`,
      footer: { text: `Checked by ${checkedBy}` },
      timestamp: new Date().toISOString(),
    });
    return embeds;
  }

  // Chunk hosped targets into embeds
  const lines = results.hosped.map(t =>
    `[${t.name}](${atkUrl(t.id)}) Lvl${t.lvl} — out in **${fmtCountdown(t.until)}**`
  );
  const chunks = chunkLines(lines);

  chunks.forEach((desc, i) => {
    embeds.push({
      color: 0xE74C3C,
      title: i === 0
        ? `🏥 Hospital Check — ${results.hosped.length} in hospital`
        : `🏥 Hospital Check (cont. ${i+1}/${chunks.length})`,
      description: desc,
      ...(i === chunks.length - 1 ? {
        footer: { text: `Checked by ${checkedBy} · ${results.available.length} available · ${results.errors ? results.errors + ' errors' : 'no errors'}` },
        timestamp: new Date().toISOString(),
      } : {}),
    });
  });

  return embeds;
}

const atkUrl = id => `https://www.torn.com/loader.php?sid=attack&user2ID=${id}`;

// Split lines into chunks that fit within Discord's 4096 char embed limit
function chunkLines(lines, maxChars = 3900) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const add = current ? '\n' + line : line;
    if (current && (current + add).length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current += add;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ── Build level list embeds ───────────────────────────────────────────────────
function buildLevelListEmbeds() {
  const main    = TARGETS.filter(t => !t.domino && !t.semper);
  const dominos = TARGETS.filter(t => t.domino);
  const semper  = TARGETS.find(t => t.semper);

  // Build all lines grouped by level (highest first)
  const byLvl = {};
  for (const t of main) {
    (byLvl[t.lvl] = byLvl[t.lvl] || []).push(t);
  }
  const allLines = [];
  for (const lvl of Object.keys(byLvl).sort((a, b) => b - a)) {
    allLines.push(`**Lvl ${lvl}**`);
    for (const t of byLvl[lvl]) {
      allLines.push(`[${t.name}](${atkUrl(t.id)}) · \`${Number(t.total).toLocaleString()}\` total`);
    }
  }

  // Chunk into embeds that fit Discord's limit
  const chunks = chunkLines(allLines);
  const embeds = chunks.map((desc, i) => ({
    color: 0x2ECC71,
    title: i === 0 ? `⚔️ Baldr Target List — ${main.length} targets` : `⚔️ Baldr Target List (cont. ${i + 1}/${chunks.length})`,
    description: desc,
    ...(i === chunks.length - 1 ? {
      footer: { text: 'Credit: Baldr [1847600] · Click name to attack' },
      timestamp: new Date().toISOString(),
    } : {}),
  }));

  // Special targets embed
  const dominoLines = dominos.map(t =>
    `[${t.name}](${atkUrl(t.id)}) Lvl${t.lvl} · \`${Number(t.total).toLocaleString()}\``
  ).join('\n');

  const semperLine = semper
    ? `[${semper.name}](${atkUrl(semper.id)}) Lvl${semper.lvl} · \`${Number(semper.total).toLocaleString()}\` total stats`
    : '_Unknown_';

  embeds.push({
    color: 0x9B59B6,
    title: '🎯 Special Targets',
    fields: [
      { name: '🁢 Domino Effect — Beat one for the award + merit point', value: dominoLines || '_None_', inline: false },
      { name: '💪 Semper Fortis / Manu Forti / Vae Victis — 3 awards + 3 merits for 1 fight', value: semperLine, inline: false },
    ],
    footer: { text: 'Semper Fortis: beat someone with more stats · Vae Victis: beat someone with 5x your stats' },
  });

  return embeds;
}

module.exports = { LEVEL_LIST_CHANNEL_ID, TARGETS, buildLevelListEmbeds, checkHospitalStatus, buildHospitalEmbeds };
