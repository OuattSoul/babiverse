// Lance tous les scénarios de bout en bout. Prérequis : backend (:8010) et client (:5173) démarrés.
import { run as account } from './account.mjs';
import { run as atelier } from './atelier.mjs';
import { run as carte } from './carte.mjs';
import { run as economy } from './economy.mjs';
import { run as interactions } from './interactions.mjs';
import { run as monde } from './monde.mjs';
import { run as ui } from './interface.mjs';
import { run as plots } from './plots.mjs';
import { run as social } from './social.mjs';
import { run as verticalSlice } from './vertical-slice.mjs';

const only = process.argv[2];
let failures = 0;
if (!only || only === 'tranche') failures += await verticalSlice();
if (!only || only === 'economie') failures += await economy();
if (!only || only === 'parcelles') failures += await plots();
if (!only || only === 'interactions') failures += await interactions();
if (!only || only === 'compte') failures += await account();
if (!only || only === 'interface') failures += await ui();
if (!only || only === 'atelier') failures += await atelier();
if (!only || only === 'carte') failures += await carte();
if (!only || only === 'monde') failures += await monde();
if (!only || only === 'social') failures += await social();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les contrôles sont passés.');
process.exit(failures ? 1 : 0);
