import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'quickstart',
    'cli',
    'export-schema',
    'templates',
    {
      type: 'category',
      label: 'Protocol',
      items: [
        'protocol',
        'protocol-reference',
        'protocol-implementor-guide',
      ],
    },
    {
      type: 'category',
      label: 'Continuous Delivery',
      items: [
        'continuous-delivery-intake',
        'multi-repo',
      ],
    },
    'adapters',
    'plugins',
    'notifications',
    'recovery',
  ],
};

export default sidebars;
