import { Metadata } from 'next';
import { redirect } from 'next/navigation';
// [HIDDEN-UI UI-OVERHAUL-1 Compliance retired from Settings; the framework
// view is kept on disk behind its component so the surface can be restored.
// import { FrameworkView } from '@/components/compliance/FrameworkView';

interface Props {
  params: Promise<{ framework: string }>;
}

const FRAMEWORK_NAMES: Record<string, string> = {
  soc2: 'SOC 2 Type II',
  iso27001: 'ISO 27001',
  nist_csf: 'NIST CSF',
  pci_dss: 'PCI DSS',
  hipaa: 'HIPAA',
  dora: 'DORA',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { framework } = await params;
  const name = FRAMEWORK_NAMES[framework] ?? framework.toUpperCase();
  return { title: `${name} Compliance` };
}

export default async function ComplianceFrameworkPage(_props: Props) {
  // [HIDDEN-UI UI-OVERHAUL-1 replaced the direct view with a redirect]
  // return (
  //   <div className="p-6">
  //     <FrameworkView framework={framework} />
  //   </div>
  // );
  redirect('/settings');
}
