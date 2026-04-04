import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'quickstart',
    'cli',
    'export-schema',
    'governance-report',
    'templates',
    {
      type: 'category',
      label: 'Protocol',
      items: [
        'protocol',
        'protocol-reference',
        'runner-interface',
        'protocol-implementor-guide',
        'remote-verification',
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
