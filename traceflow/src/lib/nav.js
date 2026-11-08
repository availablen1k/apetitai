import {
  LayoutDashboard,
  Zap,
  ShieldCheck,
  Leaf,
  Sprout,
  Database,
  FileText,
  Workflow,
  Settings,
  Truck,
  Wheat,
  GitBranch,
  Droplets,
} from 'lucide-react';

export const NAV_GROUPS = [
  {
    id: 'work',
    items: [
      { page: 'overview', path: '/', labelKey: 'nav.overview', icon: LayoutDashboard },
      { page: 'sustainability', path: '/sustainability', labelKey: 'nav.sustainability', icon: Leaf },
      { page: 'actions', path: '/actions', labelKey: 'nav.actions', icon: Zap },
      { page: 'reports', path: '/reports', labelKey: 'nav.reports', icon: FileText },
      { page: 'dataQuality', path: '/data-quality', labelKey: 'nav.dataQuality', icon: ShieldCheck },
    ],
  },
  {
    id: 'growing',
    items: [
      { page: 'rawMaterials', path: '/raw-materials', labelKey: 'nav.rawMaterials', icon: Wheat },
      { page: 'transport', path: '/transport', labelKey: 'nav.transport', icon: Truck },
      { page: 'farms', path: '/farms', labelKey: 'nav.farms', icon: Sprout },
      { page: 'nature', path: '/nature', labelKey: 'nav.nature', icon: Droplets },
    ],
  },
  {
    id: 'insight',
    items: [
      { page: 'traceability', path: '/traceability', labelKey: 'nav.traceability', icon: GitBranch },
    ],
  },
  {
    id: 'admin',
    items: [
      { page: 'platform', path: '/platform', labelKey: 'nav.platform', icon: Database },
      { page: 'automations', path: '/automations', labelKey: 'nav.automations', icon: Workflow },
      { page: 'settings', path: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

export const PAGE_TITLES = {
  '/': 'nav.overview',
  '/data-quality': 'nav.dataQuality',
  '/transport': 'nav.transport',
  '/raw-materials': 'nav.rawMaterials',
  '/traceability': 'nav.traceability',
  '/sustainability': 'nav.sustainability',
  '/actions': 'nav.actions',
  '/platform': 'nav.platform',
  '/farms': 'nav.farms',
  '/nature': 'nav.nature',
  '/reports': 'nav.reports',
  '/automations': 'nav.automations',
  '/settings': 'nav.settings',
  '/demo': 'nav.guide',
};
