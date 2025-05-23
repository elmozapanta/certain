import { IDiscoveryResult, IState } from '../../types/IState';
import { activeGameId } from '../../util/selectors';
import { getSafe } from '../../util/storeHelper';

import { getGame } from '../gamemode_management/util/getGame';

import getInstallPath from './util/getInstallPath';

import createCachedSelector from 're-reselect';
import { createSelector } from 'reselect';
import { RelaxedReselectCache } from '../../util/RelaxedReselectCache';

let installPathPattern = (state: IState) => state.settings.mods.installPath;
let gameInstallPathPattern = (state: IState, gameId: string) =>
  state.settings.mods.installPath[gameId];
let activators = (state: IState) => state.settings.mods.activator;
let allNeedToDeploy = (state: IState) => state.persistent.deployment.needToDeploy;

export let installPath = createSelector(installPathPattern, activeGameId,
    (inPaths: { [gameId: string]: string }, inGameMode: string) => {
      if (inGameMode === undefined) {
        return undefined;
      }
      return getInstallPath(inPaths[inGameMode], inGameMode);
    });

export let installPathForGame = createCachedSelector(
    gameInstallPathPattern,
    (state: IState, gameId: string) => gameId,
    (inPath: string, gameId: string) =>
      gameId !== undefined ? getInstallPath(inPath, gameId) : undefined,
  )((state, gameId) => {
    if (gameId === undefined) {
      return undefined;
    }
    return gameId;
  }, {
    cacheObject: new RelaxedReselectCache(),
  });

export let currentActivator = createSelector(activators, activeGameId,
    (inActivators: { [gameId: string]: string }, inGameMode: string) => {
      return inActivators[inGameMode];
    });

export let activatorForGame = createCachedSelector(
    activators, (state: IState, gameId: string) => gameId,
    (inActivators: { [gameId: string]: string }, gameId: string) => inActivators[gameId],
  )((state, gameId) => {
      if (gameId === undefined) {
        throw new Error('gameId can\'t be undefined');
      }
      return gameId;
  });

interface INeedToDeployMap {
  [gameId: string]: boolean;
}

export let needToDeploy = createSelector(
    allNeedToDeploy,
    activeGameId,
    (inNeedToDeploy: INeedToDeployMap, inGameMode: string) => inNeedToDeploy[inGameMode]);

export let needToDeployForGame = createCachedSelector(
    allNeedToDeploy,
    (state: IState, gameId: string) => gameId,
    (inNeedToDeploy: INeedToDeployMap, inGameId: string) => inNeedToDeploy[inGameId])(
      (state, gameId) => gameId);

let emptyObj = {};

function discoveries(state: IState) {
  return getSafe(state, ['settings', 'gameMode', 'discovered'], emptyObj);
}

export let modPathsForGame = createSelector(
  discoveries,
  (state: IState, gameId: string) => gameId,
  (inDiscoveries: { [gameId: string]: IDiscoveryResult }, inGameId: string) => {
    let game = getGame(inGameId);
    let discovery = inDiscoveries[inGameId];
    if (game === undefined) {
      return undefined;
    }
    if ((discovery === undefined) || (discovery.path === undefined)) {
      return undefined;
    }
    return game.getModPaths(discovery.path);
  },
);
