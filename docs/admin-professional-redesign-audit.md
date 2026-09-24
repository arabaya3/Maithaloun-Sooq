# Admin professional redesign — rejected UI audit

Evidence from production screenshots after `feature/admin-experience-redesign`:

1. Desktop canvas wastes width; content sits as a narrow island.
2. Metrics are identical bordered boxes with no operational hierarchy.
3. Orders filters are a stacked generic HTML form, not a toolbar.
4. Status filters are unstructured pills with equal visual weight.
5. Tables lack density, column hierarchy, and scannable next actions.
6. Sidebar nav renders as large bordered buttons, not application navigation.
7. Typography scale is weak; every panel uses the same border/background.
8. Primary and secondary actions look alike.
9. Empty states are large empty rectangles.
10. No clear separation of navigation / page header / toolbar / content / actions.

Backend and security remain unchanged: session, CSRF, services, mutations, audits, optimistic concurrency, integer agorot.

Reuse: `admin*Service`, `OrderStatusForm`, `ProductForm` progressive flows, status domain helpers, lucide-react, Noto Sans Arabic.
