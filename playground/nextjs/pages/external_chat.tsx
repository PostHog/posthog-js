import Script from 'next/script'

export default function ExternalChat() {
    return (
        <div>
            <h1>ExternalChat</h1>
            <p>This is a page for testing external chat widgets</p>

            {/* Intercom Settings Script */}
            <Script id="intercom-settings" strategy="beforeInteractive">
                {`
                    window.intercomSettings = {
                        api_base: "https://api-iam.intercom.io",
                        app_id: "cviln1h1",
                    };
                `}
            </Script>

            {/* Intercom Widget Script */}
            <Script id="intercom-widget" strategy="afterInteractive">
                {`
                    (function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic('reattach_activator');ic('update',w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://widget.intercom.io/widget/cviln1h1';var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s,x);};if(document.readyState==='complete'){l();}else if(w.attachEvent){w.attachEvent('onload',l);}else{w.addEventListener('load',l,false);}}})();
                `}
            </Script>

            {/* Crisp chat Script */}
            <Script id="crisp-chat" strategy="afterInteractive">
                {`
                    window.$crisp=[];
                    window.CRISP_WEBSITE_ID="8a81621c-0ed1-4d1f-b552-9404db8effd5";
                    (function(){
                        d = document;
                        s = d.createElement("script");
                        s.src = "https://client.crisp.chat/l.js";
                        s.async = 1;
                        d.getElementsByTagName("head")[0].appendChild(s);
                    })();
                `}
            </Script>
        </div>
    )
}
