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
    {
      type: 'category',
      label: 'Continuous Delivery',
      items: [
        'continuous-delivery-intake',
      ],
    },
    'adapters',
    'plugins',
  ],
};

export default sidebars;
