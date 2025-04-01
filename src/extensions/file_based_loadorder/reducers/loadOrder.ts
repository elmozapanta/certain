import { IReducerSpec } from '../../../types/IExtensionContext';
import { getSafe, setSafe } from '../../../util/storeHelper';

import { ILoadOrderEntry } from '../types/types';

import * as actions from '../actions/loadOrder';

export let modLoadOrderReducer: IReducerSpec = {
  reducers: {
    [actions.setFBLoadOrderEntry as any]: (state, payload) => {
      let { profileId, loEntry } = payload;
      let loadOrder = getSafe(state, [profileId], []);
      let newLO = loadOrder.reduce((accum, iter) => {
        if (iter.id === loEntry.id) {
          accum.push(loEntry);
        } else {
          accum.push(iter);
        }
        return accum;
      }, []);
      return setSafe(state, [profileId], newLO);
    },
    [actions.setFBLoadOrder as any]: (state, payload) => {
      let { profileId, loadOrder } = payload;
      if (Array.isArray(loadOrder)) {
        return setSafe(state, [profileId], loadOrder);
      } else if (typeof loadOrder === 'object') {
        let newLO = Object.keys(loadOrder)
          .reduce((accum, iter) => {
            let gameEntry = loadOrder[iter] as ILoadOrderEntry;
            if (gameEntry !== undefined) {
              accum.push(gameEntry);
            }
            return accum;
          }, []);
        return setSafe(state, [profileId], newLO);
      } else {
        return state;
      }
    },
  },
  defaults: {},
};
