/* eslint-disable */
import { IExtensionApi, IMod } from '../../types/api';
import { getSafe } from '../../util/storeHelper';

import * as _ from 'lodash';
import { ILoadOrderEntry, ILoadOrderEntryExt } from './types/types';
import { log } from '../../util/log';
import { activeGameId, lastActiveProfileForGame } from '../profile_management/selectors';

export default class UpdateSet extends Set<number> {
  private mApi: IExtensionApi;
  private mModEntries: { [modId: number]: ILoadOrderEntryExt[] } = {};
  private mInitialized = false;
  private mIsFBLO: (gameId: string) => boolean;
  constructor(api: IExtensionApi, isFBLO: (gameId: string) => boolean) {
    super([]);
    this.mApi = api;
    this.mIsFBLO = isFBLO;
  }

  public addNumericModId = (lo: ILoadOrderEntryExt) => {
    let state = this.mApi.getState();
    let gameMode = activeGameId(state);
    let mods = getSafe(state, ['persistent', 'mods', gameMode], {});
    if (lo.modId === undefined) {
      // No modId, no restoration
      return;
    }

    if (mods[lo.modId]?.attributes?.modId === undefined) {
      // The numeric id of the mod is the only unique item we can
      //  use to ascertain if we can recover this entry's index.
      return;
    }

    let numericId: number = getSafe(mods[lo.modId], ['attributes', 'modId'], -1);
    if (numericId !== -1 && (this.mModEntries[numericId] === undefined) || (!this.mModEntries[numericId].some(m => m.name === lo.name))) {
      this.mModEntries[numericId] = [].concat(this.mModEntries[numericId] || [], lo);
      super.add(numericId);
    }
    return;
  }

  public init = (gameId: string, modEntries?: ILoadOrderEntryExt[]) => {
    this.reset();
    if (!this.mIsFBLO(gameId)) {
      return;
    }
    this.mInitialized = true;
    modEntries = (!!modEntries && Array.isArray(modEntries)) ? modEntries : this.genExtendedItemsFromState();
    modEntries.forEach((iter: ILoadOrderEntryExt) => this.addNumericModId(iter));
  }

  private genExtendedItemsFromState = () => {
    let state = this.mApi.getState();
    let gameMode = activeGameId(state);
    if (!gameMode) {
      return [];
    }
    let profileId = lastActiveProfileForGame(state, gameMode);
    if (!profileId) {
      return [];
    }
    let loadOrder = getSafe(state, ['persistent', 'loadOrder', profileId], []);
    if (!loadOrder || !Array.isArray(loadOrder)) {
      return [];
    }

    let mods: { [modId: string]: IMod } = getSafe(state, ['persistent', 'mods', gameMode], {});
    let filtered = loadOrder.reduce((acc, lo, idx) => {
      let fileId = getSafe(mods[lo.modId], ['attributes', 'fileId'], undefined);
      acc.push({ ...lo, index: idx, fileId });
      return acc;
    }, []);
    return filtered;
  };

  private reset = () => {
    super.clear();
    this.mModEntries = [];
    this.mInitialized = false;
  }

  public has = (value: number): boolean => {
    return super.has(value)
      || (this.mModEntries[value] !== undefined);
  }

  public hasEntry = (entry: ILoadOrderEntry): boolean => {
    return Object.values(this.mModEntries).some(l => l.some(m => m.modId === entry.modId || m.id === entry.id));
  }

  private tryRemoveNumId = (numId: number, entries: ILoadOrderEntryExt[], nameLookup: string) => {
    if (entries.length === 1) {
      // If this is the only entry in the array, we remove all traces
      //  of this specific numeric mod id, both from the numeric set
      //  and the mod entries object.
      super.delete(numId);
      delete this.mModEntries[numId]; 
    } else {
      // Take out the entry from the mod entries object. This will ensure we don't
      //  attempt to re-arrange it again.
      this.mModEntries[numId] = entries.filter(l => l.name !== nameLookup);
    }

    if (super.size === 0) {
      this.reset();
    }
  }

  public restore = (loadOrder: ILoadOrderEntry[]): ILoadOrderEntry[] => {
    if (Object.keys(this.mModEntries).length === 0) {
      // Nothing to restore
      return loadOrder;
    }
    let restoredLO: ILoadOrderEntry[] = [...loadOrder];
    let getEntryExt = (entry: ILoadOrderEntry): ILoadOrderEntryExt | null => {
      let stored = this.findEntry(entry);
      if (!stored) {
        // This is probably an entry for a manually added mod/native game entry
        //  use the existing index.
        return { ...entry, index: loadOrder.findIndex(l => l.name === entry.name) };
      }
      return stored.entries.find(l => l.name === entry.name) || null;
    }
    restoredLO.sort((lhs, rhs) => {
      let lhsEntry = getEntryExt(lhs);
      let rhsEntry = getEntryExt(rhs);
      if (!lhsEntry || !rhsEntry) {
        return 0;
      }
      return lhsEntry.index - rhsEntry.index;
    });
    return restoredLO;
  }

  public get = (value: number): ILoadOrderEntryExt[] | null => {
    if (super.has(value) && this.mModEntries[value] !== undefined) {
      return this.mModEntries[value];
    }
    return null;
  }

  // The modId of the mod we are looking for as stored in Vortex's state.
  public findEntry = (lookUpEntry: ILoadOrderEntry): { numId: number, entries: ILoadOrderEntryExt[] } | null => {
    if (!this.hasEntry(lookUpEntry)) {
      return null;
    }

    let numericId = Object.entries(this.mModEntries).find(entry => {
      let [nId, loEntries] = entry;
      return loEntries.some(l => l.modId === lookUpEntry.modId || l.id === lookUpEntry.id);
    })?.[0];
    if (numericId === undefined) {
      return null;
    }
    return { numId: +numericId, entries: this.mModEntries[numericId] };
  }

  public add = (x: number): this => {
    log('warn', 'Use addNumericModId', x);    
    return;
  }

  public isInitialized = (): boolean => {
    return this.mInitialized;
  }
}
