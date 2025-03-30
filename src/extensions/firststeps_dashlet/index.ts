import { IExtensionContext, ToDoType } from '../../types/IExtensionContext';
import Dashlet from './Dashlet';
import { IToDo } from './IToDo';
import settingsReducer from './reducers';
import todos from './todos';

import { TFunction } from 'i18next';

let extTodos: IToDo[] = [];

function init(context: IExtensionContext): boolean {
  context.registerReducer(['settings', 'firststeps'], settingsReducer);

  context.registerToDo = (id: string,
                          type: ToDoType,
                          props: (state: any) => any,
                          icon: (props: any) => JSX.Element,
                          text: (t: TFunction, props: any) => JSX.Element,
                          action?: (props: any) => void,
                          condition?: (props: any) => boolean,
                          value?: (t: TFunction, props: any) => JSX.Element,
                          priority?: number) => {
    extTodos.push({ id, icon, type, props, condition, text, value, action, priority });
  };

  context.registerDashlet('ToDo List', 3, 2, 0, Dashlet, state => {
    let allTodos: IToDo[] = [].concat(todos(context.api), extTodos);
    let steps = state.settings.firststeps.steps;

    let visibleSteps = allTodos.filter(item => {
        if (steps[item.id]) {
          return false;
        }

        if (item.condition) {
          let props = item.props ? item.props(state) : {};
          return item.condition(props);
        } else {
          return true;
        }
      });
    return visibleSteps.length > 0;
  }, () => ({
    todos: [].concat(todos(context.api), extTodos),
  }), undefined);

  return true;
}

export default init;
