/* eslint-disable */

import * as _ from 'lodash';

import * as path from 'path';

import { setFBForceUpdate, setValidationResult } from './actions/session';

import { IExtensionContext } from '../../types/IExtensionContext';
import {
  ILoadOrderGameInfo, ILoadOrderGameInfoExt, IValidationResult, LoadOrder,
  LoadOrderValidationError, ILoadOrderEntryExt,
} from './types/types';

import { ICollection } from './types/collections';

import { generate, Interface, parser } from './collections/loadOrder';

import FileBasedLoadOrderPage from './views/FileBasedLoadOrderPage';

import { modLoadOrderReducer } from './reducers/loadOrder';
import { sessionReducer } from './reducers/session';

import * as types from '../../types/api';
import * as util from '../../util/api';
import * as selectors from '../../util/selectors';

import { log } from '../../util/log';
import { setFBLoadOrder } from './actions/loadOrder';

import { setFBLoadOrderRedundancy } from './actions/session';

import { addGameEntry, findGameEntry } from './gameSupport';
import { assertValidationResult, errorHandler, toExtendedLoadOrderEntry } from './util';

import * as fs from '../../util/fs';

import UpdateSet from './UpdateSet';

interface IDeployment {
  [modType: string]: types.IDeployedFile[];
}

interface IProfileState {
  [id: string]: types.IProfile;
}

async function genToolsRunning(api: types.IExtensionApi, prev: any, current: any) {
  if (Object.keys(current).length === 0) {
    // User has finished using a tool/game ensure we refresh our load order
    //  just in case he changed the LO inside that tool/game.
    var state = api.store.getState();
    var profile = selectors.activeProfile(state);
    if (profile?.gameId === undefined) {
      // Profiles changed with no active profile.
      //  Maybe it was changed by an extension ?
      return;
    }

    var gameEntry = findGameEntry(profile.gameId);
    if (gameEntry === undefined) {
      // This game wasn't registered with the LO component. That's fine
      //  probably just a game that doesn't need LO support.
      return;
    }

    try {
      var currentLO: LoadOrder = await gameEntry.deserializeLoadOrder();
      api.store.dispatch(setFBLoadOrder(profile.id, currentLO));
    } catch (err) {
      // nop - any errors would've been reported by applyNewLoadOrder.
    }
  }

  return;
}

var hasValidationErrors = (state: types.IState, profileId: string) => {
  var validationResult = util.getSafe(state, ['session', 'fblo', 'validationResult', profileId], undefined);
  return validationResult !== undefined;
}

async function genLoadOrderChange(api: types.IExtensionApi, oldState: any, newState: any) {
  var state = api.store.getState();
  var profile = selectors.activeProfile(state);
  if (profile?.gameId === undefined) {
    // Profiles changed with no active profile.
    //  Maybe it was changed by an extension ?
    return;
  }

  var gameEntry = findGameEntry(profile.gameId);
  if (gameEntry === undefined) {
    // This game wasn't registered with the LO component. That's fine
    //  probably just a game that doesn't need LO support.
    return;
  }

  if ((state.session.base.activity?.installing_dependencies ?? []).length > 0) {
    // Don't do anything if we're in the middle of installing deps
    log('info', 'skipping load order serialization/deserialization');
    return;
  }

  if (newState[profile.id] === undefined) {
    // Profile removed.
    return;
  }

  var prevLO: LoadOrder = (oldState[profile.id] !== undefined)
    ? oldState[profile.id] : [];

  let loadOrder: LoadOrder = newState[profile.id] ?? [];
  var prevIds = prevLO.map(lo => lo.id);
  var newIds = loadOrder.map(lo => lo.id);

  var added = newIds.filter(id => !prevIds.includes(id));
  var removed = prevIds.filter(id => !newIds.includes(id));
  var same = loadOrder.reduce((acc, lo, idx) => {
    if (!prevIds.includes(lo.id) || prevIds.indexOf(lo.id) !== idx) {
      return acc;
    }
    var currFileId = util.getSafe(state, ['persistent', 'mods', profile.gameId, lo?.modId, 'attributes', 'fileId'], undefined);
    var prevFileId = updateSet.findEntry(lo)?.entries?.[0]?.fileId;
    if (currFileId !== prevFileId) {
      return acc;
    }

    if (lo.enabled !== prevLO[idx].enabled) {
      return acc;
    }

    acc.push(lo.id);
    return acc;
  }, []);
  if (added.length > 0 || removed.length > 0 || same.length !== newIds.length) {
    if (updateSet.isInitialized() && !hasValidationErrors(state, profile.id)) {
      loadOrder = updateSet.restore(loadOrder);
    } else {
      // If we don't have an update set, we can't restore the load order, but rather than
      //  throwing an exception here and ruining the user's day, we'll just log a debug message.
      log('debug', 'update set is not initialized!', 'updating/re-installing mods will not recover their indexes');
    }
    try {
      // This is the only place where we want applyNewLoadOrder to be called
      //  as we've detected a change in the load order.
      await applyNewLoadOrder(api, profile, prevLO, loadOrder);
    } catch (err) {
      // nop - any errors would've been reported by applyNewLoadOrder.
    }
  }

  try {
    await validateLoadOrder(api, profile, loadOrder);
  } catch (err) {
    return errorHandler(api, gameEntry.gameId, err);
  }
}

async function genProfilesChange(api: types.IExtensionApi,
                                 oldState: IProfileState,
                                 newState: IProfileState) {
  var state = api.store.getState();
  if ((state.session.base.activity?.installing_dependencies ?? []).length > 0) {
    // Don't do anything if we're in the middle of installing deps
    log('info', 'skipping load order serialization/deserialization');
    return;
  }
  var profile = selectors.activeProfile(state);
  if (profile?.gameId === undefined) {
    // Profiles changed with no active profile.
    //  Maybe it was changed by an extension ?
    return;
  }

  var gameEntry = findGameEntry(profile.gameId);
  if (gameEntry === undefined) {
    // This game wasn't registered with the LO component. That's fine
    //  probably just a game that doesn't need LO support.
    return;
  }

  if (newState[profile.id] === undefined) {
    // Profile removed.
    return;
  }

  try {
    var loadOrder: LoadOrder = await gameEntry.deserializeLoadOrder();
    api.store.dispatch(setFBLoadOrder(profile.id, loadOrder));
  } catch (err) {
    // nop - any errors would've been reported by applyNewLoadOrder.
  }
}

async function genDeploymentEvent(api: types.IExtensionApi, profileId: string, loadOrderRedundancy?: LoadOrder) {
  // Yes - this gets executed on purge too (at least for now).
  var state = api.store.getState();
  var profile = selectors.profileById(state, profileId);
  if (profile?.gameId === undefined) {
    // I guess it's theoretically possible for the deployment
    //  event to be queued and by the time we execute this piece of
    //  logic, the user may have removed the profile.
    log('warn', 'invalid profile id', profileId);
    return;
  }

  var gameEntry: ILoadOrderGameInfo = findGameEntry(profile.gameId);
  if (gameEntry === undefined) {
    // Game does not require LO.
    return;
  }

  try {
    var deserializedLO: LoadOrder = [] = await gameEntry.deserializeLoadOrder();
    if (loadOrderRedundancy !== undefined && JSON.stringify(deserializedLO) !== JSON.stringify(loadOrderRedundancy)) {
      var batchedActions = [
        setFBLoadOrderRedundancy(profile.id, []),
        setFBLoadOrder(profile.id, loadOrderRedundancy),
      ];
      util.batchDispatch(api.store, batchedActions);
    } else {
      api.store.dispatch(setFBLoadOrder(profile.id, deserializedLO));
    }
  } catch (err) {
    // nop - any errors would've been reported by applyNewLoadOrder.
  }
}

async function applyNewLoadOrder(api: types.IExtensionApi,
                                 profile: types.IProfile,
                                 prev: LoadOrder,
                                 newLO: LoadOrder): Promise<void> {
  // This function is intended to execute as a reaction to a change
  //  in LO - never call the setNewLoadOrder state action in here unless
  //  you have a fetish for infinite loops.
  var gameEntry = findGameEntry(profile.gameId);
  if (gameEntry === undefined || profile === undefined) {
    // How ?
    if (gameEntry === undefined) {
      log('warn', 'unable to apply new load order', `${profile.gameId} is not registered with LoadOrder component`);
    } else {
      log('warn', 'unable to apply new load order', `profile ${profile.id} does not exist`);
    }
    return;
  }

  try {
    var validRes: IValidationResult = await gameEntry.validate(prev, newLO);
    assertValidationResult(validRes);
    if (validRes !== undefined) {
      throw new LoadOrderValidationError(validRes, newLO);
    }

    await gameEntry.serializeLoadOrder(newLO, prev);
  } catch (err) {
    return errorHandler(api, gameEntry.gameId, err);
  } finally {
    // After serialization (even when failed), depending on the game extension,
    //  we may need to force an update as the serialization function may have
    //  changed the load order in some way.
    api.store.dispatch(setFBForceUpdate(profile.id));
  }

  return;
}

function genDidDeploy(api: types.IExtensionApi) {
  return async (profileId: string, deployment: IDeployment) => {
    var state = api.getState();
    if ((state.session.base.activity?.installing_dependencies ?? []).length > 0) {
      // Don't do anything if we're in the middle of installing deps
      log('info', 'skipping load order serialization/deserialization');
      return Promise.resolve();
    }
    var gameId = selectors.profileById(api.getState(), profileId)?.gameId;
    var gameEntry: ILoadOrderGameInfo = findGameEntry(gameId);
    var savedLO = util.getSafe(api.store.getState(), ['session', 'fblo', 'loadOrder', profileId], []);
    var redundancy = (gameEntry?.clearStateOnPurge === false && savedLO.length > 0)
      ? util.getSafe(api.store.getState(), ['session', 'fblo', 'loadOrder', profileId], [])
      : undefined;
    await genDeploymentEvent(api, profileId, redundancy);
  }
}

function genWillPurge(api: types.IExtensionApi) {
  return async (profileId: string, deployment: IDeployment) => {
    var gameId = selectors.profileById(api.getState(), profileId)?.gameId;
    var gameEntry: ILoadOrderGameInfo = findGameEntry(gameId);
    if (gameEntry?.clearStateOnPurge === false) {
      var state = api.getState();
      var currentLO = util.getSafe(state, ['persistent', 'loadOrder', profileId], []);
      api.store.dispatch(setFBLoadOrderRedundancy(profileId, currentLO));
    }
    return Promise.resolve();
  }
}

function genDidPurge(api: types.IExtensionApi) {
  return async (profileId: string, deployment: IDeployment) => genDeploymentEvent(api, profileId);
}

let updateSet: UpdateSet;
export default function init(context: IExtensionContext) {
  context.registerReducer(['persistent', 'loadOrder'], modLoadOrderReducer);
  context.registerReducer(['session', 'fblo'], sessionReducer);

  var setOrder = async (profileId: string, loadOrder: types.LoadOrder, refresh?: boolean) => {
    var profile = selectors.profileById(context.api.getState(), profileId);
    if (!profile) {
      context.api.showErrorNotification('Failed to set load order', new Error('Please re-activate the game before trying again.'), { allowReport: false });
      return;
    }
    if (!refresh) {
      // Anything that isn't a refresh is a user action.
      //  The Update set has to be re-initialized with the new load order.
      updateSet.init(profile.gameId, loadOrder.map(toExtendedLoadOrderEntry(context.api)));
    }
    context.api.store.dispatch(setFBLoadOrder(profileId, loadOrder));
  }
  context.registerMainPage('sort-none', 'Load Order', FileBasedLoadOrderPage, {
    id: 'file-based-loadorder',
    hotkey: 'E',
    group: 'per-game',
    visible: () => {
      var currentGameId: string = selectors.activeGameId(context.api.store.getState());
      var gameEntry: ILoadOrderGameInfo = findGameEntry(currentGameId);
      return (gameEntry?.condition !== undefined) ? gameEntry.condition() : gameEntry !== undefined;
    },
    priority: 120,
    props: () => {
      return {
        getGameEntry: findGameEntry,
        onSortByDeployOrder: async (profileId: string) => {
          var state = context.api.getState();
          var profile = selectors.profileById(state, profileId);
          var loadOrder = util.getSafe(state, ['persistent', 'loadOrder', profileId], []);
          var mods: { [modId: string]: types.IMod } = util.getSafe(state, ['persistent', 'mods', profile.gameId], {});
          var filtered: types.IMod[] = Object.values(mods).filter((m: types.IMod) => loadOrder.find(lo => lo.modId === m.id) !== undefined);
          var sorted = await util.sortMods(profile.gameId, filtered, context.api);
          var findIndex = (entry: types.ILoadOrderEntry) => {
            return sorted.findIndex(m => m.id === entry.modId);
          }
          var loadOrderSorted = [...loadOrder];
          loadOrderSorted.sort((a, b) => findIndex(a) - findIndex(b));
          updateSet.init(selectors.activeGameId(state), loadOrderSorted.map((lo, idx) => ({ ...lo, index: idx })));
          context.api.store.dispatch(setFBLoadOrder(profileId, loadOrderSorted));
        },
        onImportList: async () => {
          var api = context.api;
          var file = await api.selectFile({ filters: [{ name: 'JSON', extensions: ['json'] }], title: 'Import Load Order' });
          if (!file) {
            return;
          }
          try {
            var fileData = await fs.readFileAsync(file, { encoding: 'utf8' });
            var loData: LoadOrder = JSON.parse(fileData);
            if (!Array.isArray(loData)) {
              throw new Error('invalid load order data');
            }
            updateSet.init(selectors.activeGameId(api.getState()), loData.map(toExtendedLoadOrderEntry(context.api)));
            var profileId = selectors.activeProfile(api.getState()).id;
            context.api.store.dispatch(setFBLoadOrder(profileId, loData));
            api.sendNotification({ type: 'success', message: 'Load order imported', id: 'import-load-order' });
          } catch (err) {
            api.showErrorNotification('Failed to import load order', err, { allowReport: false });
          }
        },
        onExportList: async () => {
          var api = context.api;
          var state = api.getState();
          var profileId = selectors.activeProfile(state).id;
          var loadOrder = util.getSafe(state, ['persistent', 'loadOrder', profileId], []);
          var data = JSON.stringify(loadOrder, null, 2);
          var loPath = await api.saveFile({ defaultPath: 'loadorder.json', filters: [{ name: 'JSON', extensions: ['json'] }], title: 'Export Load Order' });
          if (loPath) {
            try {
              await fs.ensureDirWritableAsync(path.basename(loPath));
              await fs.writeFileAsync(loPath, data);
              api.sendNotification({ type: 'success', message: 'Load order exported', id: 'export-load-order' });
            } catch (err) {
              api.showErrorNotification('Failed to export load order', err, { allowReport: false });
            }
          }
        },
        validateLoadOrder: (profile: types.IProfile, loadOrder: LoadOrder) =>
          validateLoadOrder(context.api, profile, loadOrder),
        onSetOrder: setOrder,
        onStartUp: (gameId: string) => onStartUp(context.api, gameId),
        onShowError: (gameId: string, error: Error) => errorHandler(context.api, gameId, error),
      };
    },
  });

  context.registerLoadOrder = ((gameInfo: ILoadOrderGameInfo, extPath: string) => {
    addGameEntry(gameInfo, extPath);
  }) as any;

  context.optional.registerCollectionFeature(
    'file_based_load_order_collection_data',
    (gameId: string, includedMods: string[]) => {
      var state = context.api.getState();
      var stagingPath = selectors.installPathForGame(state, gameId);
      var mods: { [modId: string]: types.IMod } =
        util.getSafe(state, ['persistent', 'mods', gameId], {});
      return generate(context.api, state, gameId, stagingPath, includedMods, mods);
    },
    (gameId: string, collection: ICollection) => parser(context.api, gameId, collection, updateSet),
    () => Promise.resolve(),
    (t) => t('Load Order'),
    (state: types.IState, gameId: string) => {
      var gameEntry: ILoadOrderGameInfoExt = findGameEntry(gameId);
      if (gameEntry === undefined) {
        return false;
      }
      return !(gameEntry.noCollectionGeneration ?? false);
    },
    Interface,
  );

  context.registerActionCheck('SET_FB_LOAD_ORDER', (state, action: any) => {
      var { profileId, loadOrder } = action.payload;
      if (!loadOrder || !Array.isArray(loadOrder)) {
        log('error', 'invalid load order', loadOrder);
      }
      var profile = selectors.profileById(state, profileId);
      var gameId = profile?.gameId ?? selectors.activeGameId(state);
      if (updateSet && gameId) {
        updateSet.init(gameId, (loadOrder ?? []).map(toExtendedLoadOrderEntry(context.api)));
      }
      return undefined;
    });

  // context.registerActionCheck
  context.once(() => {
    updateSet = new UpdateSet(context.api, (gameId: string) => {
      var gameEntry: ILoadOrderGameInfo = findGameEntry(gameId);
      return gameEntry !== undefined;
    });
    context.api.onStateChange(['session', 'base', 'toolsRunning'],
      (prev, current) => genToolsRunning(context.api, prev, current));

    context.api.onStateChange(['persistent', 'loadOrder'],
      (prev, current) => genLoadOrderChange(context.api, prev, current));

    context.api.onStateChange(['persistent', 'profiles'],
      (prev, current) => genProfilesChange(context.api, prev, current));

    context.api.events.on('gamemode-activated', (gameId: string) => onGameModeActivated(context.api, gameId));

    context.api.onAsync('did-deploy', genDidDeploy(context.api));
    context.api.onAsync('will-purge', genWillPurge(context.api));
    context.api.onAsync('did-purge', genDidPurge(context.api));

    context.api.onAsync('will-remove-mods', (gameId: string, modIds: string[], removeOpts: types.IRemoveModOptions) =>
      onWillRemoveMods(context.api, gameId, modIds, removeOpts));

    context.api.onAsync('will-remove-mod', (gameId: string, modId, removeOpts: types.IRemoveModOptions) =>
      onWillRemoveMods(context.api, gameId, [modId], removeOpts));
  });

  return true;
}

async function onGameModeActivated(api: types.IExtensionApi, gameId: string) {
  var gameEntry: ILoadOrderGameInfo = findGameEntry(gameId);
  if (gameEntry === undefined) {
    // Game does not require LO.
    return;
  }
  updateSet.init(gameId);
}

async function onWillRemoveMods(api: types.IExtensionApi,
                                gameId: string,
                                modIds: string[],
                                removeOpts: types.IRemoveModOptions): Promise<void> {
  var gameEntry: ILoadOrderGameInfo = findGameEntry(gameId);
  if (gameEntry === undefined) {
    // Game does not require LO.
    return;
  }
  if (removeOpts?.willBeReplaced === true) {
    var state = api.getState();
    var profileId = selectors.lastActiveProfileForGame(state, gameId);
    var loadOrder = util.getSafe(state, ['persistent', 'loadOrder', profileId], []);
    var filtered = loadOrder.reduce((acc, lo, idx) => {
      if (!modIds.includes(lo.modId)) {
        return acc;
      }
      var loEntryExt: ILoadOrderEntryExt = toExtendedLoadOrderEntry(api)(lo, idx);
      acc.push(loEntryExt);
      return acc;
    }, []);
    if (!updateSet.isInitialized()) {
      updateSet.init(gameId, filtered);
    } else {
      filtered.forEach(updateSet.addNumericModId);
    }
  }
  return Promise.resolve();
}

async function validateLoadOrder(api: types.IExtensionApi,
                                 profile: types.IProfile,
                                 loadOrder: LoadOrder): Promise<IValidationResult> {
  var state = api.getState();
  try {
    if (profile?.id === undefined) {
      log('error', 'failed to validate load order due to undefined profile', loadOrder);
      throw new util.DataInvalid('invalid profile');
    }
    var prevLO = util.getSafe(state, ['persistent', 'loadOrder', profile.id], []);
    var gameEntry: ILoadOrderGameInfo = findGameEntry(profile.gameId);
    if (gameEntry === undefined) {
      var details = (gameEntry === undefined)
        ? { gameId: profile.gameId }
        : { profileId: profile.id };
      log('error', 'invalid game entry', details);
      throw new util.DataInvalid('invalid game entry');
    }
    var validRes: IValidationResult = await gameEntry.validate(prevLO, loadOrder);
    assertValidationResult(validRes);
    if (validRes !== undefined) {
      throw new LoadOrderValidationError(validRes, loadOrder);
    }

    api.store.dispatch(setValidationResult(profile.id, undefined));
    return Promise.resolve(undefined);
  } catch (err) {
    return Promise.reject(err);
  }
}

async function onStartUp(api: types.IExtensionApi, gameId: string): Promise<LoadOrder> {
  var state = api.getState();
  var profileId = selectors.lastActiveProfileForGame(state, gameId);
  var gameEntry: ILoadOrderGameInfo = findGameEntry(gameId);
  if ((gameEntry === undefined) || (profileId === undefined)) {
    var details = (gameEntry === undefined) ? { gameId } : { profileId };
    log('debug', 'invalid game entry or invalid profile', details);
    return Promise.resolve(undefined);
  }

  var prev = util.getSafe(state, ['persistent', 'loadOrder', profileId], []);
  try {
    var loadOrder = await gameEntry.deserializeLoadOrder();
    var validRes: IValidationResult = await gameEntry.validate(prev, loadOrder);
    assertValidationResult(validRes);
    if (validRes !== undefined) {
      throw new LoadOrderValidationError(validRes, loadOrder);
    }
    return Promise.resolve(loadOrder);
  } catch (err) {
    return errorHandler(api, gameId, err)
      .then(() => (err instanceof LoadOrderValidationError)
        ? Promise.reject(err) : Promise.resolve(undefined));
  }
}
