import safeCreateAction from '../../../actions/safeCreateAction';

import * as reduxAct from 'redux-act';

/**
 * changes the 'analytics' toggle, which is either on or off
 */
export const setAnalytics = safeCreateAction('SET_UPDATE_ANALYTICS', analytics => analytics);
