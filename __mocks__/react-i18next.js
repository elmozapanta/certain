'use strict';

import React from 'react';

const react_i18n = jest.genMockFromModule('react-i18next');

function translate(namespace) {
  return (component) => {
    return class Translation extends React.Component {
      render() {
        return React.createElement(component, Object.assign({}, this.props, {
          t: (str) => str
        }), []);
      }
    }
  } 
}

react_i18n.withTranslation = translate;

module.exports = react_i18n;
