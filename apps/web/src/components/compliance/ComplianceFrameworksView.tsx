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
    <div className="space-y-6">
      <div>
        <h1 className="text-page-title font-bold text-fg-primary">Compliance Frameworks</h1>
        <p className="text-fg-muted text-body mt-1">
          Select a framework to view controls, collect evidence, and export reports.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FRAMEWORKS.map((fw) => (
          <Link
            key={fw.id}
            href={`/compliance/${fw.id}`}
            className="block bg-surface-card border border-surface-border rounded-container p-5 hover:bg-surface-elevated hover:border-surface-border-strong transition-colors group"
          >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-fg-primary font-semibold text-card-title group-hover:text-accent transition-colors">
                {fw.name}
              </h2>
              <span className="ml-2 flex-shrink-0 text-xs bg-surface-subtle text-fg-secondary px-2 py-0.5 rounded-pill">
                {fw.badge}
              </span>
            </div>
            <p className="text-fg-muted text-body leading-relaxed">{fw.description}</p>
            <div className="mt-4 text-accent text-xs font-medium group-hover:text-accent-hover">
              View Dashboard →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
