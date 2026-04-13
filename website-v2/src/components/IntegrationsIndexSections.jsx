import React from 'react';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';

export default function IntegrationsIndexSections({ sections }) {
  return sections.map((section) => (
    <section key={section.title}>
      <Heading as="h2">{section.title}</Heading>
      <ul>
        {section.items.map((item) => (
          <li key={item.href}>
            <Link to={item.href}>{item.title}</Link> — {item.summary}
          </li>
        ))}
      </ul>
    </section>
  ));
}
