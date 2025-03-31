import safeCreateAction from '../../../actions/safeCreateAction';

import * as reduxAct from 'redux-act';

/**
 * sets the list of known/supported games
 */
export let setKnownGames = safeCreateAction('SET_KNOWN_GAMES', games => games);

export let clearGameDisabled = safeCreateAction('CLEAR_GAME_DISABLED');

export let setGameDisabled = safeCreateAction('SET_GAME_DISABLED',
  (gameId: string, disabledBy: string) => ({ gameId, disabledBy }));
