import type { Metadata } from "next";
import Navbar from "@/components/marketing/Navbar";
import Hero from "@/components/marketing/Hero";
import HowItWorks from "@/components/marketing/HowItWorks";
import Features from "@/components/marketing/Features";
import LeadIntelligence from "@/components/marketing/LeadIntelligence";
import AIAssistant from "@/components/marketing/AIAssistant";
import Automation from "@/components/marketing/Automation";
import CRM from "@/components/marketing/CRM";
import Analytics from "@/components/marketing/Analytics";
import Security from "@/components/marketing/Security";
import Pricing from "@/components/marketing/Pricing";
import FAQSection from "@/components/marketing/FAQSection";
import FinalCTA from "@/components/marketing/FinalCTA";
import Footer from "@/components/marketing/Footer";

// TODO: set NEXT_PUBLIC_SITE_URL to the production domain (e.g. https://wddaisalesos.com)
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://wdd-ai-sales-os.vercel.app";

const title = "WDD AI SALES OS — Turn the Internet Into Your Sales Pipeline";
const description =
  "Discover qualified prospects, understand their business, personalize outreach and manage your entire sales workflow with AI.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "WDD AI SALES OS",
    title,
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "WDD AI SALES OS",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description,
  url: siteUrl,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "INR",
    description: "Free plan available; paid tiers coming soon.",
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <LeadIntelligence />
        <AIAssistant />
        <Automation />
        <CRM />
        <Analytics />
        <Security />
        <Pricing />
        <FAQSection />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
