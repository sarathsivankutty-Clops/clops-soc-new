import Link from 'next/link';

const FRAMEWORKS = [
  {
    id: 'soc2',
    name: 'SOC 2 Type II',
    description: 'Trust Services Criteria for security, availability, and confidentiality.',
    badge: 'Enterprise',
  },
  {
    id: 'iso27001',
    name: 'ISO/IEC 27001:2022',
    description: 'International standard for information security management systems.',
    badge: 'International',
  },
  {
    id: 'nist_csf',
    name: 'NIST CSF 2.0',
    description: 'NIST Cybersecurity Framework covering Govern, Identify, Protect, Detect, Respond, Recover.',
    badge: 'US Government',
  },
  {
    id: 'pci_dss',
    name: 'PCI DSS v4.0',
    description: 'Payment Card Industry Data Security Standard for cardholder data environments.',
    badge: 'Financial',
  },
  {
    id: 'hipaa',
    name: 'HIPAA Security Rule',
    description: 'Administrative, physical, and technical safeguards for protected health information.',
    badge: 'Healthcare',
  },
  {
    id: 'dora',
    name: 'DORA',
    description: 'EU Digital Operational Resilience Act for financial sector ICT risk management.',
    badge: 'EU Regulation',
  },
];

export function ComplianceFrameworksView() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg-primary">Compliance Frameworks</h1>
        <p className="text-fg-muted text-sm mt-1">
          Select a framework to view controls, collect evidence, and export reports.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FRAMEWORKS.map((fw) => (
          <Link
            key={fw.id}
            href={`/compliance/${fw.id}`}
            className="block bg-surface-card border border-surface-border rounded-lg p-5 hover:border-brand-500 hover:bg-surface-hover transition-all group"
          >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-fg-primary font-semibold text-base group-hover:text-brand-400 transition-colors">
                {fw.name}
              </h2>
              <span className="ml-2 flex-shrink-0 text-xs bg-surface-subtle text-fg-secondary px-2 py-0.5 rounded-full">
                {fw.badge}
              </span>
            </div>
            <p className="text-fg-muted text-sm leading-relaxed">{fw.description}</p>
            <div className="mt-4 text-brand-400 text-xs font-medium group-hover:text-brand-300">
              View Dashboard →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
