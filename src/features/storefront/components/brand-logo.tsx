import Link from "next/link";

export function BrandLogo() {
  return (
    <Link className="brand" href="/">
      <span className="brand-word">
        <span className="brand-word-soq">سوق</span>{" "}
        <span className="brand-word-name">ميثلون</span>
        <span className="sr-only">، الرئيسية</span>
      </span>
      <span className="brand-tagline" aria-hidden="true">
        منظفات ومعطرات جو
      </span>
    </Link>
  );
}
