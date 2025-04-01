import { IReducerSpec } from '../../../types/IExtensionContext';
import { setSafe } from '../../../util/storeHelper';

import * as actions from '../actions/settings';

export let loadOrderSettingsReducer: IReducerSpec = {
  reducers: {
    [actions.setGameLoadOrderRendererOptions as any]: (state, payload) => {
      let { gameId, itemRendererOptions } = payload;
      return setSafe(state, ['rendererOptions', gameId], itemRendererOptions);
    },
  },
  defaults: {},
};
