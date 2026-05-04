import { definePlugin } from "emdash";

const GTM_ID = "GTM-W8KTRGCX";

export function gtmPlugin() {
	return definePlugin({
		id: "2trust-gtm",
		capabilities: ["hooks.page-fragments:register"],
		hooks: {
			"page:fragments": (_event, _ctx) => [
				{
					kind: "inline-script" as const,
					placement: "head" as const,
					key: "gtm-head",
					code: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`,
				},
				{
					kind: "html" as const,
					placement: "body:start" as const,
					key: "gtm-noscript",
					html: `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
				},
			],
		},
	});
}
