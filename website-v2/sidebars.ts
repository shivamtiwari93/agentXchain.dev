import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'quickstart',
    'cli',
    {
      type: 'category',
      label: 'Protocol',
      items: [
        'protocol',
        'protocol-implementor-guide',
      ],
    },
    'adapters',
    'plugins',
  ],
};

export default sidebars;
