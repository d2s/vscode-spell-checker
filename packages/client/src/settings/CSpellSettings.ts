import * as fs from 'fs-extra';
import * as json from 'comment-json';
import * as path from 'path';
import { CSpellUserSettingsWithComments } from '../server';
import { unique, uniqueFilter } from '../util';
import { Uri } from 'vscode';

const currentSettingsFileVersion = '0.2';

export const defaultFileName = 'cspell.json';

export const configFileLocations = [
    // Original locations
    '.cspell.json',
    'cspell.json',
    '.cSpell.json',
    'cSpell.json',
    // Original locations jsonc
    '.cspell.jsonc',
    'cspell.jsonc',
    // Alternate locations
    '.vscode/cspell.json',
    '.vscode/cSpell.json',
    '.vscode/.cspell.json',
    // Standard Locations
    'cspell.config.json',
    'cspell.config.jsonc',
    'cspell.config.yaml',
    'cspell.config.yml',
    'cspell.yaml',
    'cspell.yml',
    // Dynamic config is looked for last
    'cspell.config.js',
    'cspell.config.cjs',
];

export const nestedConfigLocations = ['package.json'];

const regIsJson = /\.jsonc?$/;
const regIsPackageJson = /package\.json$/i;

export const possibleConfigFiles = new Set(configFileLocations.concat(nestedConfigLocations));
/**
 * A set of files that if changed, could indicate that the cspell configuration changed.
 *
 * An alias of possibleConfigFiles
 */
export const configFilesToWatch = possibleConfigFiles;

export interface CSpellSettings extends CSpellUserSettingsWithComments {}

const defaultSettings: CSpellSettings = Object.freeze({
    version: currentSettingsFileVersion,
});

export function getDefaultSettings(): CSpellSettings {
    return defaultSettings;
}

export function readRawSettingsFile(filename: Uri): Promise<string | undefined> {
    return fs.readFile(filename.fsPath, 'utf8').catch((reason) => {
        return isNodeError(reason) && reason.code === 'ENOENT' ? undefined : Promise.reject(reason);
    });
}

export function readSettings(filename: Uri, defaultSettingsIfNotFound?: CSpellSettings): Promise<CSpellSettings> {
    const defaults = defaultSettingsIfNotFound ?? defaultSettings;
    return readRawSettingsFile(filename).then((cfgJson) => (cfgJson === undefined ? defaults : (json.parse(cfgJson) as CSpellSettings)));
}

export function writeSettings(filename: Uri, settings: CSpellSettings): Promise<CSpellSettings> {
    const fsPath = filename.fsPath;
    return fs
        .mkdirp(path.dirname(fsPath))
        .then(() => fs.writeFile(fsPath, json.stringify(settings, null, 4)))
        .then(() => settings);
}

export function addWordToSettingsAndUpdate(filename: Uri, word: string): Promise<CSpellSettings> {
    return readSettingsFileAndApplyUpdate(filename, (settings) => addWordsToSettings(settings, normalizeWord(word)));
}

export function addWordsToSettings(settings: CSpellSettings, wordsToAdd: string[]): CSpellSettings {
    const words = mergeWords(settings.words, wordsToAdd);
    return { ...settings, words };
}

export function addIgnoreWordToSettingsAndUpdate(filename: Uri, word: string): Promise<CSpellSettings> {
    return readSettingsFileAndApplyUpdate(filename, (settings) => addIgnoreWordsToSettings(settings, normalizeWord(word)));
}

export function addIgnoreWordsToSettings(settings: CSpellSettings, wordsToAdd: string[]): CSpellSettings {
    const ignoreWords = mergeWords(settings.ignoreWords, wordsToAdd);
    return { ...settings, ignoreWords };
}

function mergeWords(wordsLeft: string[] | undefined, wordsRight: string[]): string[] {
    const words = (wordsLeft || [])
        .concat(wordsRight)
        .map((a) => a.trim())
        .filter((a) => !!a)
        .filter(uniqueFilter());

    words.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return words;
}

export function removeWordsFromSettings(settings: CSpellSettings, wordsToRemove: string[]): CSpellSettings {
    const words = filterOutWords(settings.words || [], wordsToRemove);
    return { ...settings, words };
}

export function filterOutWords(words: string[], wordsToRemove: string[]): string[] {
    const toRemove = new Set(wordsToRemove.map((w) => w.toLowerCase()));
    return words.filter((w) => !toRemove.has(w.toLowerCase()));
}

export function removeWordFromSettingsAndUpdate(filename: Uri, word: string): Promise<CSpellSettings> {
    return readSettingsFileAndApplyUpdate(filename, (settings) => removeWordsFromSettings(settings, normalizeWord(word)));
}

export function addLanguageIdsToSettings(settings: CSpellSettings, languageIds: string[], onlyIfExits: boolean): CSpellSettings {
    if (settings.enabledLanguageIds || !onlyIfExits) {
        const enabledLanguageIds = unique((settings.enabledLanguageIds || []).concat(languageIds));
        return { ...settings, enabledLanguageIds };
    }
    return settings;
}

export function removeLanguageIdsFromSettings(settings: CSpellSettings, languageIds: string[]): CSpellSettings {
    if (settings.enabledLanguageIds) {
        const excludeLangIds = new Set(languageIds);
        const enabledLanguageIds = settings.enabledLanguageIds.filter((a) => !excludeLangIds.has(a));
        const newSettings: CSpellSettings = { ...settings, enabledLanguageIds };
        if (!newSettings.enabledLanguageIds?.length) {
            delete newSettings.enabledLanguageIds;
        }
        return newSettings;
    }
    return settings;
}

export function writeAddLanguageIdsToSettings(filename: Uri, languageIds: string[], onlyIfExits: boolean): Promise<CSpellSettings> {
    return readSettingsFileAndApplyUpdate(filename, (settings) => addLanguageIdsToSettings(settings, languageIds, onlyIfExits));
}

export function removeLanguageIdsFromSettingsAndUpdate(filename: Uri, languageIds: string[]): Promise<CSpellSettings> {
    return readSettingsFileAndApplyUpdate(filename, (settings) => removeLanguageIdsFromSettings(settings, languageIds));
}

export async function readSettingsFileAndApplyUpdate(
    cspellConfigUri: Uri,
    action: (settings: CSpellSettings) => CSpellSettings
): Promise<CSpellSettings> {
    if (!isUpdateSupportedForConfigFileFormat(cspellConfigUri)) {
        return Promise.reject(
            new FailedToUpdateConfigFile(`Update for config file format not supported\nFile: ${cspellConfigUri.toString()}`)
        );
    }
    const settings = await readSettings(cspellConfigUri);
    const newSettings = action(settings);
    return writeSettings(cspellConfigUri, newSettings);
}

export function normalizeWord(word: string): string[] {
    return [word].map((a) => a.trim()).filter((a) => !!a);
}

export function isUpdateSupportedForConfigFileFormat(uri: Uri): boolean {
    const u = uri.with({ fragment: '', query: '' });
    const s = u.toString();
    return regIsJson.test(s) && !regIsPackageJson.test(s);
}

export class FailedToUpdateConfigFile extends Error {
    constructor(message: string) {
        super(message);
    }
}

interface NodeError extends Error {
    code: string;
}

function isError(e: any): e is Error {
    return e instanceof Error || ((<Error>e).name !== undefined && (<Error>e).message !== undefined);
}

function isNodeError(e: any): e is NodeError {
    return isError(e) && (<NodeError>e).code !== undefined;
}
