import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'quickstart',
    'cli',
    {
      type: 'category',
      label: 'Release Notes',
      items: [
        'releases/v2-17-0',
        'releases/v2-16-0',
        'releases/v2-15-0',
        'releases/v2-14-0',
        'releases/v2-13-0',
        'releases/v2-12-0',
        'releases/v2-11-0',
      ],
    },
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
        'build-your-own-runner',
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
