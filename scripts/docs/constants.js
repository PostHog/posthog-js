const HOG_REF = '0.3';

const PROPERTIES_EXAMPLE = `// Properties is a Record<string, Property> 
// Below are PostHog's default properties, you can add your own properties during capture
{
    $timestamp: '2024-05-29T17:32:07.202Z',
    $os: 'Mac OS X',
    $os_version: '10.15.7',
    $browser: 'Chrome',
    $browser_version: '125',
    $device_type: 'Desktop',
    $current_url: 'https://example.com/page',
    $host: 'example.com',
    $pathname: '/page',
    $screen_height: 1080,
    $screen_width: 1920,
    $viewport_height: 950,
    $viewport_width: 1903,
    $lib: 'web',
    $lib_version: '1.31.0',
    $search_engine: 'google',
    $referrer: 'https://google.com',
    $referring_domain: 'www.google.com',
    $active_feature_flags: ['beta_feature'],
    $event_type: 'click',
    $utm_source: 'newsletter',
    $utm_medium: 'email',
    $utm_campaign: 'product_launch',
    $utm_term: 'new+product',
    $utm_content: 'logolink',
    $gclid: 'TeSter-123',
    $gad_source: 'google_ads',
    $gclsrc: 'dsa',
    $dclid: 'testDclid123',
    $wbraid: 'testWbraid123',
    $gbraid: 'testGbraid123',
    $fbclid: 'testFbclid123',
    $msclkid: 'testMsclkid123',
    $twclid: 'testTwclid123',
    $li_fat_id: 'testLiFatId123',
    $mc_cid: 'testMcCid123',
    $igshid: 'testIgshid123',
    $ttclid: 'testTtclid123',
    $plugins_succeeded: ['GeoIP (56578)'],
    $plugins_failed: ['plugin3'],
    $plugins_deferred: ['plugin4'],
    $ip: '192.168.1.1'
}`;

const PROPERTY_EXAMPLE = `// It can be a string
"max@example.com"
// It can be an object like field
{
    firstName: 'Max',
    lastName: 'Hog',
    isAdmin: true,
}
`
module.exports = {
    HOG_REF,
    PROPERTIES_EXAMPLE,
    PROPERTY_EXAMPLE
}; 

