import { PostHog } from 'posthog-core'
import {
    BasicSurveyQuestion,
    LinkSurveyQuestion,
    MultipleSurveyQuestion,
    RatingSurveyQuestion,
    Survey,
    SurveyAppearance,
    SurveyQuestion,
} from '../posthog-surveys-types'

const satisfiedEmoji =
    '<svg class="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M626-533q22.5 0 38.25-15.75T680-587q0-22.5-15.75-38.25T626-641q-22.5 0-38.25 15.75T572-587q0 22.5 15.75 38.25T626-533Zm-292 0q22.5 0 38.25-15.75T388-587q0-22.5-15.75-38.25T334-641q-22.5 0-38.25 15.75T280-587q0 22.5 15.75 38.25T334-533Zm146 272q66 0 121.5-35.5T682-393h-52q-23 40-63 61.5T480.5-310q-46.5 0-87-21T331-393h-53q26 61 81 96.5T480-261Zm0 181q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z"/></svg>'
const neutralEmoji =
    '<svg class="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M626-533q22.5 0 38.25-15.75T680-587q0-22.5-15.75-38.25T626-641q-22.5 0-38.25 15.75T572-587q0 22.5 15.75 38.25T626-533Zm-292 0q22.5 0 38.25-15.75T388-587q0-22.5-15.75-38.25T334-641q-22.5 0-38.25 15.75T280-587q0 22.5 15.75 38.25T334-533Zm20 194h253v-49H354v49ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z"/></svg>'
const dissatisfiedEmoji =
    '<svg class="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M626-533q22.5 0 38.25-15.75T680-587q0-22.5-15.75-38.25T626-641q-22.5 0-38.25 15.75T572-587q0 22.5 15.75 38.25T626-533Zm-292 0q22.5 0 38.25-15.75T388-587q0-22.5-15.75-38.25T334-641q-22.5 0-38.25 15.75T280-587q0 22.5 15.75 38.25T334-533Zm146.174 116Q413-417 358.5-379.5T278-280h53q22-42 62.173-65t87.5-23Q528-368 567.5-344.5T630-280h52q-25-63-79.826-100-54.826-37-122-37ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z"/></svg>'
const veryDissatisfiedEmoji =
    '<svg class="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M480-417q-67 0-121.5 37.5T278-280h404q-25-63-80-100t-122-37Zm-183-72 50-45 45 45 31-36-45-45 45-45-31-36-45 45-50-45-31 36 45 45-45 45 31 36Zm272 0 44-45 51 45 31-36-45-45 45-45-31-36-51 45-44-45-31 36 44 45-44 45 31 36ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142 0 241-99t99-241q0-142-99-241t-241-99q-142 0-241 99t-99 241q0 142 99 241t241 99Z"/></svg>'
const verySatisfiedEmoji =
    '<svg class="emoji-svg" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M479.504-261Q537-261 585.5-287q48.5-26 78.5-72.4 6-11.6-.75-22.6-6.75-11-20.25-11H316.918Q303-393 296.5-382t-.5 22.6q30 46.4 78.5 72.4 48.5 26 105.004 26ZM347-578l27 27q7.636 8 17.818 8Q402-543 410-551q8-8 8-18t-8-18l-42-42q-8.8-9-20.9-9-12.1 0-21.1 9l-42 42q-8 7.636-8 17.818Q276-559 284-551q8 8 18 8t18-8l27-27Zm267 0 27 27q7.714 8 18 8t18-8q8-7.636 8-17.818Q685-579 677-587l-42-42q-8.8-9-20.9-9-12.1 0-21.1 9l-42 42q-8 7.714-8 18t8 18q7.636 8 17.818 8Q579-543 587-551l27-27ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 340q142.375 0 241.188-98.812Q820-337.625 820-480t-98.812-241.188Q622.375-820 480-820t-241.188 98.812Q140-622.375 140-480t98.812 241.188Q337.625-140 480-140Z"/></svg>'
const cancelSVG =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M0.164752 0.164752C0.384422 -0.0549175 0.740578 -0.0549175 0.960248 0.164752L6 5.20451L11.0398 0.164752C11.2594 -0.0549175 11.6156 -0.0549175 11.8352 0.164752C12.0549 0.384422 12.0549 0.740578 11.8352 0.960248L6.79549 6L11.8352 11.0398C12.0549 11.2594 12.0549 11.6156 11.8352 11.8352C11.6156 12.0549 11.2594 12.0549 11.0398 11.8352L6 6.79549L0.960248 11.8352C0.740578 12.0549 0.384422 12.0549 0.164752 11.8352C-0.0549175 11.6156 -0.0549175 11.2594 0.164752 11.0398L5.20451 6L0.164752 0.960248C-0.0549175 0.740578 -0.0549175 0.384422 0.164752 0.164752Z" fill="black"/></svg>'
const posthogLogo =
    '<svg width="77" height="14" viewBox="0 0 77 14" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_2415_6911)"><mask id="mask0_2415_6911" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="77" height="14"><path d="M0.5 0H76.5V14H0.5V0Z" fill="white"/></mask><g mask="url(#mask0_2415_6911)"><path d="M5.77226 8.02931C5.59388 8.37329 5.08474 8.37329 4.90634 8.02931L4.4797 7.20672C4.41155 7.07535 4.41155 6.9207 4.4797 6.78933L4.90634 5.96669C5.08474 5.62276 5.59388 5.62276 5.77226 5.96669L6.19893 6.78933C6.26709 6.9207 6.26709 7.07535 6.19893 7.20672L5.77226 8.02931ZM5.77226 12.6946C5.59388 13.0386 5.08474 13.0386 4.90634 12.6946L4.4797 11.872C4.41155 11.7406 4.41155 11.586 4.4797 11.4546L4.90634 10.632C5.08474 10.288 5.59388 10.288 5.77226 10.632L6.19893 11.4546C6.26709 11.586 6.26709 11.7406 6.19893 11.872L5.77226 12.6946Z" fill="#1D4AFF"/><path d="M0.5 10.9238C0.5 10.508 1.02142 10.2998 1.32637 10.5938L3.54508 12.7327C3.85003 13.0267 3.63405 13.5294 3.20279 13.5294H0.984076C0.716728 13.5294 0.5 13.3205 0.5 13.0627V10.9238ZM0.5 8.67083C0.5 8.79459 0.551001 8.91331 0.641783 9.00081L5.19753 13.3927C5.28831 13.4802 5.41144 13.5294 5.53982 13.5294H8.0421C8.47337 13.5294 8.68936 13.0267 8.3844 12.7327L1.32637 5.92856C1.02142 5.63456 0.5 5.84278 0.5 6.25854V8.67083ZM0.5 4.00556C0.5 4.12932 0.551001 4.24802 0.641783 4.33554L10.0368 13.3927C10.1276 13.4802 10.2508 13.5294 10.3791 13.5294H12.8814C13.3127 13.5294 13.5287 13.0267 13.2237 12.7327L1.32637 1.26329C1.02142 0.969312 0.5 1.17752 0.5 1.59327V4.00556ZM5.33931 4.00556C5.33931 4.12932 5.39033 4.24802 5.4811 4.33554L14.1916 12.7327C14.4965 13.0267 15.0179 12.8185 15.0179 12.4028V9.99047C15.0179 9.86671 14.9669 9.74799 14.8762 9.66049L6.16568 1.26329C5.86071 0.969307 5.33931 1.17752 5.33931 1.59327V4.00556ZM11.005 1.26329C10.7 0.969307 10.1786 1.17752 10.1786 1.59327V4.00556C10.1786 4.12932 10.2296 4.24802 10.3204 4.33554L14.1916 8.06748C14.4965 8.36148 15.0179 8.15325 15.0179 7.7375V5.3252C15.0179 5.20144 14.9669 5.08272 14.8762 4.99522L11.005 1.26329Z" fill="#F9BD2B"/><path d="M21.0852 10.981L16.5288 6.58843C16.2238 6.29443 15.7024 6.50266 15.7024 6.91841V13.0627C15.7024 13.3205 15.9191 13.5294 16.1865 13.5294H23.2446C23.5119 13.5294 23.7287 13.3205 23.7287 13.0627V12.5032C23.7287 12.2455 23.511 12.0396 23.2459 12.0063C22.4323 11.9042 21.6713 11.546 21.0852 10.981ZM18.0252 12.0365C17.5978 12.0365 17.251 11.7021 17.251 11.2901C17.251 10.878 17.5978 10.5436 18.0252 10.5436C18.4527 10.5436 18.7996 10.878 18.7996 11.2901C18.7996 11.7021 18.4527 12.0365 18.0252 12.0365Z" fill="currentColor"/><path d="M0.5 13.0627C0.5 13.3205 0.716728 13.5294 0.984076 13.5294H3.20279C3.63405 13.5294 3.85003 13.0267 3.54508 12.7327L1.32637 10.5938C1.02142 10.2998 0.5 10.508 0.5 10.9238V13.0627ZM5.33931 5.13191L1.32637 1.26329C1.02142 0.969306 0.5 1.17752 0.5 1.59327V4.00556C0.5 4.12932 0.551001 4.24802 0.641783 4.33554L5.33931 8.86412V5.13191ZM1.32637 5.92855C1.02142 5.63455 0.5 5.84278 0.5 6.25853V8.67083C0.5 8.79459 0.551001 8.91331 0.641783 9.00081L5.33931 13.5294V9.79717L1.32637 5.92855Z" fill="#1D4AFF"/><path d="M10.1787 5.3252C10.1787 5.20144 10.1277 5.08272 10.0369 4.99522L6.16572 1.26329C5.8608 0.969306 5.33936 1.17752 5.33936 1.59327V4.00556C5.33936 4.12932 5.39037 4.24802 5.48114 4.33554L10.1787 8.86412V5.3252ZM5.33936 13.5294H8.04214C8.47341 13.5294 8.6894 13.0267 8.38443 12.7327L5.33936 9.79717V13.5294ZM5.33936 5.13191V8.67083C5.33936 8.79459 5.39037 8.91331 5.48114 9.00081L10.1787 13.5294V9.99047C10.1787 9.86671 10.1277 9.74803 10.0369 9.66049L5.33936 5.13191Z" fill="#F54E00"/><path d="M29.375 11.6667H31.3636V8.48772H33.0249C34.8499 8.48772 36.0204 7.4443 36.0204 5.83052C36.0204 4.21681 34.8499 3.17334 33.0249 3.17334H29.375V11.6667ZM31.3636 6.84972V4.81136H32.8236C33.5787 4.81136 34.0318 5.19958 34.0318 5.83052C34.0318 6.4615 33.5787 6.84972 32.8236 6.84972H31.3636ZM39.618 11.7637C41.5563 11.7637 42.9659 10.429 42.9659 8.60905C42.9659 6.78905 41.5563 5.45438 39.618 5.45438C37.6546 5.45438 36.2701 6.78905 36.2701 8.60905C36.2701 10.429 37.6546 11.7637 39.618 11.7637ZM38.1077 8.60905C38.1077 7.63838 38.7118 6.97105 39.618 6.97105C40.5116 6.97105 41.1157 7.63838 41.1157 8.60905C41.1157 9.57972 40.5116 10.2471 39.618 10.2471C38.7118 10.2471 38.1077 9.57972 38.1077 8.60905ZM46.1482 11.7637C47.6333 11.7637 48.6402 10.8658 48.6402 9.81025C48.6402 7.33505 45.2294 8.13585 45.2294 7.16518C45.2294 6.8983 45.5189 6.72843 45.9342 6.72843C46.3622 6.72843 46.8782 6.98318 47.0418 7.54132L48.527 6.94678C48.2375 6.06105 47.1677 5.45438 45.8713 5.45438C44.4743 5.45438 43.6058 6.25518 43.6058 7.21372C43.6058 9.53118 46.9663 8.88812 46.9663 9.84665C46.9663 10.1864 46.6391 10.417 46.1482 10.417C45.4434 10.417 44.9525 9.94376 44.8015 9.3735L43.3164 9.93158C43.6436 10.8537 44.6001 11.7637 46.1482 11.7637ZM53.4241 11.606L53.2982 10.0651C53.0843 10.1743 52.8074 10.2106 52.5808 10.2106C52.1278 10.2106 51.8257 9.89523 51.8257 9.34918V7.03172H53.3612V5.55145H51.8257V3.78001H49.9755V5.55145H48.9687V7.03172H49.9755V9.57972C49.9755 11.06 51.0202 11.7637 52.3921 11.7637C52.7696 11.7637 53.122 11.7031 53.4241 11.606ZM59.8749 3.17334V6.47358H56.376V3.17334H54.3874V11.6667H56.376V8.11158H59.8749V11.6667H61.8761V3.17334H59.8749ZM66.2899 11.7637C68.2281 11.7637 69.6378 10.429 69.6378 8.60905C69.6378 6.78905 68.2281 5.45438 66.2899 5.45438C64.3265 5.45438 62.942 6.78905 62.942 8.60905C62.942 10.429 64.3265 11.7637 66.2899 11.7637ZM64.7796 8.60905C64.7796 7.63838 65.3837 6.97105 66.2899 6.97105C67.1835 6.97105 67.7876 7.63838 67.7876 8.60905C67.7876 9.57972 67.1835 10.2471 66.2899 10.2471C65.3837 10.2471 64.7796 9.57972 64.7796 8.60905ZM73.2088 11.4725C73.901 11.4725 74.5177 11.242 74.845 10.8416V11.424C74.845 12.1034 74.2786 12.5767 73.4102 12.5767C72.7935 12.5767 72.2523 12.2854 72.1642 11.788L70.4776 12.0428C70.7042 13.1955 71.925 13.972 73.4102 13.972C75.361 13.972 76.6574 12.8679 76.6574 11.2298V5.55145H74.8324V6.07318C74.4926 5.69705 73.9136 5.45438 73.171 5.45438C71.409 5.45438 70.3014 6.61918 70.3014 8.46345C70.3014 10.3077 71.409 11.4725 73.2088 11.4725ZM72.1012 8.46345C72.1012 7.55345 72.655 6.97105 73.5109 6.97105C74.3793 6.97105 74.9331 7.55345 74.9331 8.46345C74.9331 9.37345 74.3793 9.95585 73.5109 9.95585C72.655 9.95585 72.1012 9.37345 72.1012 8.46345Z" fill="currentColor"/></g></g><defs><clipPath id="clip0_2415_6911"><rect width="76" height="14" fill="white" transform="translate(0.5)"/></clipPath></defs></svg>'
const checkSVG =
    '<svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.30769 10.6923L4.77736 11.2226C4.91801 11.3633 5.10878 11.4423 5.30769 11.4423C5.5066 11.4423 5.69737 11.3633 5.83802 11.2226L5.30769 10.6923ZM15.5303 1.53033C15.8232 1.23744 15.8232 0.762563 15.5303 0.46967C15.2374 0.176777 14.7626 0.176777 14.4697 0.46967L15.5303 1.53033ZM1.53033 5.85429C1.23744 5.56139 0.762563 5.56139 0.46967 5.85429C0.176777 6.14718 0.176777 6.62205 0.46967 6.91495L1.53033 5.85429ZM5.83802 11.2226L15.5303 1.53033L14.4697 0.46967L4.77736 10.162L5.83802 11.2226ZM0.46967 6.91495L4.77736 11.2226L5.83802 10.162L1.53033 5.85429L0.46967 6.91495Z" fill="currentColor"/></svg>'

const style = (id: string, appearance: SurveyAppearance | null) => {
    const positions = {
        left: 'left: 30px;',
        right: 'right: 30px;',
        center: `
            left: 50%;
            transform: translateX(-50%);
          `,
    }
    return `
          .survey-${id}-form {
              position: fixed;
              margin: 0px;
              bottom: 0px;
              color: black;
              font-weight: normal;
              font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              text-align: left;
              max-width: ${parseInt(appearance?.maxWidth || '290')}px;
              z-index: ${parseInt(appearance?.zIndex || '99999')};
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              border-bottom: 0px;
              width: 100%;
              ${positions[appearance?.position || 'right'] || 'right: 30px;'}
          }
          .survey-${id}-form .tab {
              display: none;
          }
          .form-submit[disabled] {
              opacity: 0.6;
              filter: grayscale(100%);
              cursor: not-allowed;
          }
          .survey-${id}-form {
              flex-direction: column;
              background: ${appearance?.backgroundColor || '#eeeded'};
              border-top-left-radius: 10px;
              border-top-right-radius: 10px;
              box-shadow: -6px 0 16px -8px rgb(0 0 0 / 8%), -9px 0 28px 0 rgb(0 0 0 / 5%), -12px 0 48px 16px rgb(0 0 0 / 3%);
          }
          .survey-${id}-form textarea {
              color: #2d2d2d;
              font-size: 14px;
              font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              background: white;
              color: black;
              outline: none;
              padding-left: 10px;
              padding-right: 10px;
              padding-top: 10px;
              border-radius: 6px;
              border-color: ${appearance?.borderColor || '#c9c6c6'};
              margin-top: 14px; 
          }
          .form-submit {
              box-sizing: border-box;
              margin: 0;
              font-family: inherit;
              overflow: visible;
              text-transform: none;
              position: relative;
              display: inline-block;
              font-weight: 700;
              white-space: nowrap;
              text-align: center;
              border: 1.5px solid transparent;
              cursor: pointer;
              user-select: none;
              touch-action: manipulation;
              padding: 12px;
              font-size: 14px;
              border-radius: 6px;
              outline: 0;
              background: ${appearance?.submitButtonColor || 'black'} !important;
              text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.12);
              box-shadow: 0 2px 0 rgba(0, 0, 0, 0.045);
              width: 100%;
          }
          .form-cancel {
              float: right;
              border: none;
              background: none;
              cursor: pointer;
          }
          .cancel-btn-wrapper {
              position: absolute;
              width: 35px;
              height: 35px;
              border-radius: 100%;
              top: 0;
              right: 0;
              transform: translate(50%, -50%);
              background: white;
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              display: flex;
              justify-content: center;
              align-items: center;
          }
          .bolded { font-weight: 600; }
          .buttons {
              display: flex;
              justify-content: center;
          }
          .footer-branding {
              font-size: 11px;
              margin-top: 10px;
              text-align: center;
              display: flex;
              justify-content: center;
              gap: 4px;
              align-items: center;
              font-weight: 500;
              background: ${appearance?.backgroundColor || '#eeeded'};
              text-decoration: none;
          }
          .survey-${id}-box {
              padding: 20px 25px 10px;
              display: flex;
              flex-direction: column;
          }
          .survey-question {
              font-weight: 500;
              font-size: 14px;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .question-textarea-wrapper {
              display: flex;
              flex-direction: column;
          }
          .description {
              font-size: 13px;
              margin-top: 5px;
              opacity: .60;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .ratings-number {
              background-color: ${appearance?.ratingButtonColor || 'white'};
              font-size: 14px;
              padding: 8px 0px;
              border: none;
          }
          .ratings-number:hover {
              cursor: pointer;
          }
          .rating-options {
              margin-top: 14px;
          }
          .rating-options-buttons {
              display: grid;
              border-radius: 6px;
              overflow: hidden;
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
          }
          .rating-options-buttons > .ratings-number {
              border-right: 1px solid ${appearance?.borderColor || '#c9c6c6'};
          }
          .rating-options-buttons > .ratings-number:last-of-type {
              border-right: 0px;
          }
          .rating-options-buttons .rating-active {
              background: ${appearance?.ratingButtonActiveColor || 'black'};
          }
          .rating-options-emoji {
              display: flex;
              justify-content: space-between;
          }
          .ratings-emoji {
              font-size: 16px;
              background-color: transparent;
              border: none;
              padding: 0px;
          }
          .ratings-emoji:hover {
              cursor: pointer;
          }
          .ratings-emoji.rating-active svg {
              fill: ${appearance?.ratingButtonActiveColor || 'black'};
          }
          .emoji-svg {
              fill: ${appearance?.ratingButtonColor || '#c9c6c6'};
          }
          .rating-text {
              display: flex;
              flex-direction: row;
              font-size: 11px;
              justify-content: space-between;
              margin-top: 6px;
              background: ${appearance?.backgroundColor || '#eeeded'};
              opacity: .60;
          }
          .multiple-choice-options {
              margin-top: 13px;
              font-size: 14px;
          }
          .multiple-choice-options .choice-option {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 13px;
              cursor: pointer;
              margin-bottom: 5px;
              position: relative;
          }
          .multiple-choice-options > .choice-option:last-of-type {
              margin-bottom: 0px;
          }
          
          .multiple-choice-options input {
              cursor: pointer;
              position: absolute;
              opacity: 0;
          }
          .choice-check {
              position: absolute;
              right: 10px;
              background: white;
          }
          .choice-check svg {
              display: none;
          }
          .multiple-choice-options .choice-option:hover .choice-check svg {
              display: inline-block;
              opacity: .25;
          }
          .multiple-choice-options input:checked + label + .choice-check svg {
              display: inline-block;
              opacity: 100% !important;
          }
          .multiple-choice-options input[type=checkbox]:checked + label {
              font-weight: bold;
          }
          .multiple-choice-options input:checked + label {
              border: 1.5px solid rgba(0,0,0);
          }
          .multiple-choice-options label {
              width: 100%;
              cursor: pointer;
              padding: 10px;
              border: 1.5px solid rgba(0,0,0,.25);
              border-radius: 4px;
              background: white;
          }
          .thank-you-message {
              position: fixed;
              bottom: 0px;
              z-index: ${parseInt(appearance?.zIndex || '99999')};
              box-shadow: -6px 0 16px -8px rgb(0 0 0 / 8%), -9px 0 28px 0 rgb(0 0 0 / 5%), -12px 0 48px 16px rgb(0 0 0 / 3%);
              font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              border-top-left-radius: 10px;
              border-top-right-radius: 10px;
              padding: 20px 25px 10px;
              background: ${appearance?.backgroundColor || '#eeeded'};
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              text-align: center;
              max-width: ${parseInt(appearance?.maxWidth || '290')}px;
              min-width: 150px;
              width: 100%;
              ${positions[appearance?.position || 'right'] || 'right: 30px;'}
          }
          .thank-you-message {
              color: ${appearance?.textColor || 'black'};
          }
          .thank-you-message-body {
              margin-top: 6px;
              font-size: 14px;
              color: ${appearance?.descriptionTextColor || '#4b4b52'};
          }
          .thank-you-message-header {
              margin: 10px 0px 0px;
          }
          .thank-you-message-container .form-submit {
              margin-top: 20px;
              margin-bottom: 10px;
          }
          .thank-you-message-countdown {
              margin-left: 6px;
          }
          .bottom-section {
              margin-top: 14px;
          }
          `
}

export const createShadow = (styleSheet: string, surveyId: string) => {
    const div = document.createElement('div')
    div.className = `PostHogSurvey${surveyId}`
    const shadow = div.attachShadow({ mode: 'open' })
    if (styleSheet) {
        const styleElement = Object.assign(document.createElement('style'), {
            innerText: styleSheet,
        })
        shadow.appendChild(styleElement)
    }
    document.body.appendChild(div)
    return shadow
}

export const closeSurveyPopup = (surveyId: string, surveyPopup: HTMLFormElement) => {
    Object.assign(surveyPopup.style, { display: 'none' })
    localStorage.setItem(`seenSurvey_${surveyId}`, 'true')
    window.setTimeout(() => {
        window.dispatchEvent(new Event('PHSurveyClosed'))
    }, 2000)
    surveyPopup.reset()
}

export const createOpenTextOrLinkPopup = (
    posthog: PostHog,
    survey: Survey,
    question: BasicSurveyQuestion | LinkSurveyQuestion,
    questionIndex: number
) => {
    const surveyQuestionType = question.type
    const surveyDescription = question.description
    const questionText = question.question
    const isOptional = !!question.optional
    const form = `
    <div class="survey-${survey.id}-box">
        <div class="cancel-btn-wrapper">
            <button class="form-cancel" type="cancel">${cancelSVG}</button>
        </div>
        <div class="question-textarea-wrapper">
            <div class="survey-question auto-text-color">${questionText}</div>
            ${surveyDescription ? `<span class="description auto-text-color">${surveyDescription}</span>` : ''}
            ${
                surveyQuestionType === 'open'
                    ? `<textarea class="survey-textarea-question${questionIndex}" name="survey" rows=4 placeholder="${
                          survey.appearance?.placeholder || ''
                      }"></textarea>`
                    : ''
            }
        </div>
        <div class="bottom-section">
            <div class="buttons">
                <button class="form-submit auto-text-color" type="submit">${
                    survey.appearance?.submitButtonText || 'Submit'
                }</button>
            </div>
            <a href="https://posthog.com" target="_blank" rel="noopener" class="footer-branding auto-text-color">Survey by ${posthogLogo}</a>
        </div>
    </div>
`
    let formElement: HTMLFormElement | HTMLDivElement
    if (survey.questions.length === 1) {
        formElement = Object.assign(document.createElement('form'), {
            className: `survey-${survey.id}-form`,
            innerHTML: form,
            onsubmit: function (e: any) {
                e.preventDefault()
                const surveyQuestionType = question.type
                posthog.capture('survey sent', {
                    $survey_name: survey.name,
                    $survey_id: survey.id,
                    $survey_question: survey.questions[0].question,
                    $survey_response: surveyQuestionType === 'open' ? e.target.survey.value : 'link clicked',
                    sessionRecordingUrl: posthog.get_session_replay_url?.(),
                })
                if (surveyQuestionType === 'link') {
                    window.open(question.link || undefined)
                }
                window.setTimeout(() => {
                    window.dispatchEvent(new Event('PHSurveySent'))
                }, 200)
                closeSurveyPopup(survey.id, formElement as HTMLFormElement)
            },
        })
    } else {
        formElement = Object.assign(document.createElement('div'), {
            innerHTML: form,
        })
        const submitButton = formElement.querySelector('.form-submit') as HTMLButtonElement
        submitButton.addEventListener('click', () => {
            if (surveyQuestionType === 'link') {
                window.open(question.link || undefined)
            }
        })
    }
    if (!isOptional) {
        if (surveyQuestionType === 'open') {
            ;(formElement.querySelector('.form-submit') as HTMLButtonElement).disabled = true
        }
        formElement.addEventListener('input', (e: any) => {
            if (formElement.querySelector('.form-submit')) {
                const submitButton = formElement.querySelector('.form-submit') as HTMLButtonElement
                submitButton.disabled = !e.target.value
            }
        })
    }

    return formElement
}

export const createThankYouMessage = (survey: Survey) => {
    const thankYouHTML = `
    <div class="thank-you-message-container">
        <div class="cancel-btn-wrapper">
            <button class="form-cancel" type="cancel">${cancelSVG}</button>
        </div>
        <h3 class="thank-you-message-header">${survey.appearance?.thankYouMessageHeader || 'Thank you!'}</h3>
        <div class="thank-you-message-body">${survey.appearance?.thankYouMessageDescription || ''}</div>
        <button class="form-submit auto-text-color"><span>Close</span><span class="thank-you-message-countdown"></span></button>
        ${
            survey.appearance?.whiteLabel
                ? ''
                : `<a href="https://posthog.com" target="_blank" rel="noopener" class="footer-branding auto-text-color">Survey by ${posthogLogo}</a>`
        }
    </div>
    `
    const thankYouElement = Object.assign(document.createElement('div'), {
        className: `thank-you-message`,
        innerHTML: thankYouHTML,
    })
    return thankYouElement
}

export const addCancelListeners = (
    posthog: PostHog,
    surveyPopup: HTMLFormElement,
    surveyId: string,
    surveyEventName: string
) => {
    const cancelButton = surveyPopup.getElementsByClassName('form-cancel')?.[0] as HTMLButtonElement

    cancelButton.addEventListener('click', (e) => {
        e.preventDefault()
        Object.assign(surveyPopup.style, { display: 'none' })
        localStorage.setItem(`seenSurvey_${surveyId}`, 'true')
        posthog.capture('survey dismissed', {
            $survey_name: surveyEventName,
            $survey_id: surveyId,
            sessionRecordingUrl: posthog.get_session_replay_url(),
        })
        window.dispatchEvent(new Event('PHSurveyClosed'))
    })
}

export const createRatingsPopup = (
    posthog: PostHog,
    survey: Survey,
    question: RatingSurveyQuestion,
    questionIndex: number
) => {
    const scale = question.scale
    const starting = question.scale === 10 ? 0 : 1
    const displayType = question.display
    const isOptional = !!question.optional
    const ratingOptionsElement = document.createElement('div')
    if (displayType === 'number') {
        ratingOptionsElement.className = 'rating-options-buttons'
        ratingOptionsElement.style.gridTemplateColumns = `repeat(${scale - starting + 1}, minmax(0, 1fr))`
        for (let i = starting; i <= scale; i++) {
            const buttonElement = document.createElement('button')
            buttonElement.className = `ratings-number question-${questionIndex}-rating-${i} auto-text-color`
            buttonElement.type = 'submit'
            buttonElement.value = `${i}`
            buttonElement.innerHTML = `${i}`
            ratingOptionsElement.append(buttonElement)
        }
    } else if (displayType === 'emoji') {
        ratingOptionsElement.className = 'rating-options-emoji'
        const threeEmojis = [dissatisfiedEmoji, neutralEmoji, satisfiedEmoji]
        const fiveEmojis = [veryDissatisfiedEmoji, dissatisfiedEmoji, neutralEmoji, satisfiedEmoji, verySatisfiedEmoji]
        for (let i = 1; i <= scale; i++) {
            const emojiElement = document.createElement('button')
            emojiElement.className = `ratings-emoji question-${questionIndex}-rating-${i}`
            emojiElement.type = 'submit'
            emojiElement.value = `${i}`
            emojiElement.innerHTML = scale === 3 ? threeEmojis[i - 1] : fiveEmojis[i - 1]
            ratingOptionsElement.append(emojiElement)
        }
    }
    const ratingsForm = `
    <div class="survey-${survey.id}-box">
        <div class="cancel-btn-wrapper">
            <button class="form-cancel" type="cancel">${cancelSVG}</button>
        </div>
        <div class="survey-question auto-text-color">${question.question}</div>
        ${question.description ? `<span class="description auto-text-color">${question.description}</span>` : ''}
        <div class="rating-section">
            <div class="rating-options">
            </div>
            ${
                question.lowerBoundLabel || question.upperBoundLabel
                    ? `<div class="rating-text auto-text-color">
            <div>${question.lowerBoundLabel || ''}</div>
            <div>${question.upperBoundLabel || ''}</div>
            </div>`
                    : ''
            }
            <div class="bottom-section">
            <div class="buttons">
                <button class="form-submit auto-text-color" type="submit" ${isOptional ? '' : 'disabled'}>${
        survey.appearance?.submitButtonText || 'Submit'
    }</button>
            </div>
            <a href="https://posthog.com" target="_blank" rel="noopener" class="footer-branding auto-text-color">Survey by ${posthogLogo}</a>
        </div>
        </div>
    </div>
            `
    let formElement: HTMLFormElement | HTMLDivElement
    if (survey.questions.length === 1) {
        formElement = Object.assign(document.createElement('form'), {
            className: `survey-${survey.id}-form`,
            innerHTML: ratingsForm,
            onsubmit: (e: Event) => {
                e.preventDefault()
                const activeRatingEl = formElement.querySelector('.rating-active')
                posthog.capture('survey sent', {
                    $survey_name: survey.name,
                    $survey_id: survey.id,
                    $survey_question: question.question,
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore // TODO: Fix this, error because it doesn't know that the target is a button
                    $survey_response: parseInt(activeRatingEl?.value),
                    sessionRecordingUrl: posthog.get_session_replay_url?.(),
                })
                window.setTimeout(() => {
                    window.dispatchEvent(new Event('PHSurveySent'))
                }, 200)
                closeSurveyPopup(survey.id, formElement as HTMLFormElement)
            },
        })
    } else {
        formElement = Object.assign(document.createElement('div'), {
            innerHTML: ratingsForm,
        })
    }
    formElement.getElementsByClassName('rating-options')[0].insertAdjacentElement('afterbegin', ratingOptionsElement)
    const allElements = question.scale === 10 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5]
    for (const x of allElements) {
        const ratingEl = formElement.getElementsByClassName(`question-${questionIndex}-rating-${x}`)[0]
        ratingEl.addEventListener('click', (e) => {
            e.preventDefault()
            for (const activeRatingEl of formElement.getElementsByClassName('rating-active')) {
                activeRatingEl.classList.remove('rating-active')
            }
            ratingEl.classList.add('rating-active')
            if (formElement.querySelector('.form-submit')) {
                ;(formElement.querySelector('.form-submit') as HTMLButtonElement).disabled = false
            }
            setTextColors(formElement)
        })
    }

    return formElement
}

export const createMultipleChoicePopup = (
    posthog: PostHog,
    survey: Survey,
    question: MultipleSurveyQuestion,
    questionIndex: number
) => {
    const surveyQuestion = question.question
    const surveyDescription = question.description
    const surveyQuestionChoices = question.choices
    const singleOrMultiSelect = question.type
    const isOptional = !!question.optional

    const form = `
    <div class="survey-${survey.id}-box">
        <div class="cancel-btn-wrapper">
            <button class="form-cancel" type="cancel">${cancelSVG}</button>
        </div>
        <div class="survey-question auto-text-color">${surveyQuestion}</div>
        ${surveyDescription ? `<span class="description auto-text-color">${surveyDescription}</span>` : ''}
        <div class="multiple-choice-options">
        ${surveyQuestionChoices
            .map((option, idx) => {
                const inputType = singleOrMultiSelect === 'single_choice' ? 'radio' : 'checkbox'
                const singleOrMultiSelectString = `<div class="choice-option"><input type=${inputType} id=surveyQuestion${questionIndex}MultipleChoice${idx} name="choice" value="${option}">
            <label class="auto-text-color" for=surveyQuestion${questionIndex}MultipleChoice${idx}>${option}</label><span class="choice-check auto-text-color">${checkSVG}</span></div>`
                return singleOrMultiSelectString
            })
            .join(' ')}
        </div>
        <div class="bottom-section">
        <div class="buttons">
            <button class="form-submit auto-text-color" type="submit" ${isOptional ? '' : 'disabled'}>${
        survey.appearance?.submitButtonText || 'Submit'
    }</button>
        </div>
        <a href="https://posthog.com" target="_blank" rel="noopener" class="footer-branding auto-text-color">Survey by ${posthogLogo}</a>
    </div>

    </div>
    `
    let formElement: HTMLFormElement | HTMLDivElement
    if (survey.questions.length === 1) {
        formElement = Object.assign(document.createElement('form'), {
            className: `survey-${survey.id}-form`,
            innerHTML: form,
            onsubmit: (e: Event) => {
                e.preventDefault()
                const targetElement = e.target as HTMLFormElement
                const selectedChoices =
                    singleOrMultiSelect === 'single_choice'
                        ? (targetElement.querySelector('input[type=radio]:checked') as HTMLInputElement)?.value
                        : [
                              ...(targetElement.querySelectorAll(
                                  'input[type=checkbox]:checked'
                              ) as NodeListOf<HTMLInputElement>),
                          ].map((choice) => choice.value)
                posthog.capture('survey sent', {
                    $survey_name: survey.name,
                    $survey_id: survey.id,
                    $survey_question: survey.questions[0].question,
                    $survey_response: selectedChoices,
                    sessionRecordingUrl: posthog.get_session_replay_url?.(),
                })
                window.setTimeout(() => {
                    window.dispatchEvent(new Event('PHSurveySent'))
                }, 200)
                closeSurveyPopup(survey.id, formElement as HTMLFormElement)
            },
        })
    } else {
        formElement = Object.assign(document.createElement('div'), {
            innerHTML: form,
        })
    }
    if (!isOptional) {
        formElement.addEventListener('change', () => {
            const selectedChoices: NodeListOf<HTMLInputElement> =
                singleOrMultiSelect === 'single_choice'
                    ? formElement.querySelectorAll('input[type=radio]:checked')
                    : formElement.querySelectorAll('input[type=checkbox]:checked')
            if ((selectedChoices.length ?? 0) > 0) {
                ;(formElement.querySelector('.form-submit') as HTMLButtonElement).disabled = false
            } else {
                ;(formElement.querySelector('.form-submit') as HTMLButtonElement).disabled = true
            }
        })
    }

    return formElement
}

export const callSurveys = (posthog: PostHog, forceReload: boolean = false) => {
    posthog?.getActiveMatchingSurveys((surveys) => {
        const nonAPISurveys = surveys.filter((survey) => survey.type !== 'api')
        nonAPISurveys.forEach((survey) => {
            if (document.querySelectorAll("div[class^='PostHogSurvey']").length === 0) {
                const surveyWaitPeriodInDays = survey.conditions?.seenSurveyWaitPeriodInDays
                const lastSeenSurveyDate = localStorage.getItem(`lastSeenSurveyDate`)
                if (surveyWaitPeriodInDays && lastSeenSurveyDate) {
                    const today = new Date()
                    const diff = Math.abs(today.getTime() - new Date(lastSeenSurveyDate).getTime())
                    const diffDaysFromToday = Math.ceil(diff / (1000 * 3600 * 24))
                    if (diffDaysFromToday < surveyWaitPeriodInDays) {
                        return
                    }
                }

                if (!localStorage.getItem(`seenSurvey_${survey.id}`)) {
                    const shadow = createShadow(style(survey.id, survey?.appearance), survey.id)
                    let surveyPopup
                    if (survey.questions.length < 2) {
                        surveyPopup = createSingleQuestionSurvey(
                            posthog,
                            survey,
                            survey.questions[0]
                        ) as HTMLFormElement
                    } else {
                        surveyPopup = createMultipleQuestionSurvey(posthog, survey)
                    }
                    if (surveyPopup) {
                        addCancelListeners(posthog, surveyPopup, survey.id, survey.name)
                        if (survey.appearance?.whiteLabel) {
                            ;(
                                surveyPopup.getElementsByClassName('footer-branding')[0] as HTMLAnchorElement
                            ).style.display = 'none'
                        }
                        shadow.appendChild(surveyPopup)
                    }
                    if (survey.questions.length > 1) {
                        const currentQuestion = 0
                        showQuestion(currentQuestion, survey.id)
                    }
                    setTextColors(shadow)
                    window.dispatchEvent(new Event('PHSurveyShown'))
                    posthog.capture('survey shown', {
                        $survey_name: survey.name,
                        $survey_id: survey.id,
                        sessionRecordingUrl: posthog.get_session_replay_url?.(),
                    })
                    localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())
                    if (survey.appearance?.displayThankYouMessage) {
                        window.addEventListener('PHSurveySent', () => {
                            const thankYouElement = createThankYouMessage(survey)
                            shadow.appendChild(thankYouElement)
                            const cancelButtons = thankYouElement.querySelectorAll('.form-cancel, .form-submit')
                            for (const button of cancelButtons) {
                                button.addEventListener('click', () => {
                                    thankYouElement.remove()
                                })
                            }
                            const countdownEl = thankYouElement.querySelector('.thank-you-message-countdown')
                            if (countdownEl) {
                                let count = 3
                                countdownEl.textContent = `(${count})`
                                const countdown = setInterval(() => {
                                    count -= 1
                                    if (count <= 0) {
                                        clearInterval(countdown)
                                        thankYouElement.remove()
                                        return
                                    }
                                    countdownEl.textContent = `(${count})`
                                }, 1000)
                            }
                            setTextColors(shadow)
                        })
                    }
                }
            }
        })
    }, forceReload)
}

export const createMultipleQuestionSurvey = (posthog: PostHog, survey: Survey) => {
    const questions = survey.questions
    const questionTypeMapping = {
        open: createOpenTextOrLinkPopup,
        link: createOpenTextOrLinkPopup,
        rating: createRatingsPopup,
        single_choice: createMultipleChoicePopup,
        multiple_choice: createMultipleChoicePopup,
    }
    const multipleQuestionForm = Object.assign(document.createElement('form'), {
        className: `survey-${survey.id}-form`,
        onsubmit: (e: Event) => {
            e.preventDefault()
            const multipleQuestionResponses: Record<string, string | number | string[] | null> = {}
            const allTabs = (e.target as HTMLDivElement).getElementsByClassName('tab')
            for (const [index, tab] of [...allTabs].entries()) {
                const classes = tab.classList
                const questionType = classes[2]
                let response
                if (questionType === 'open') {
                    response = tab.querySelector('textarea')?.value
                } else if (questionType === 'link') {
                    response = 'link clicked'
                } else if (questionType === 'rating') {
                    response = parseInt((tab.querySelector('.rating-active') as HTMLButtonElement)?.value)
                } else if (questionType === 'single_choice' || questionType === 'multiple_choice') {
                    const selectedChoices =
                        questionType === 'single_choice'
                            ? (tab.querySelector('input[type=radio]:checked') as HTMLInputElement).value
                            : [
                                  ...(tab.querySelectorAll(
                                      'input[type=checkbox]:checked'
                                  ) as NodeListOf<HTMLInputElement>),
                              ].map((choice) => choice.value)
                    response = selectedChoices
                }
                const isQuestionOptional = survey.questions[index].optional
                if (isQuestionOptional && response === undefined) {
                    response = null
                }
                if (response !== undefined) {
                    if (index === 0) {
                        multipleQuestionResponses['$survey_response'] = response
                    } else {
                        multipleQuestionResponses[`$survey_response_${index}`] = response
                    }
                }
            }
            posthog.capture('survey sent', {
                $survey_name: survey.name,
                $survey_id: survey.id,
                $survey_questions: survey.questions.map((question) => question.question),
                sessionRecordingUrl: posthog.get_session_replay_url?.(),
                ...multipleQuestionResponses,
            })
            window.setTimeout(() => {
                window.dispatchEvent(new Event('PHSurveySent'))
            }, 200)
            closeSurveyPopup(survey.id, multipleQuestionForm)
        },
    })

    questions.map((question, idx) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore // TODO: Fix this, error because of survey question type mapping
        const questionElement = questionTypeMapping[question.type](posthog, survey, question, idx)
        const questionTab = document.createElement('div')
        questionTab.className = `tab question-${idx} ${question.type}`
        if (idx < questions.length - 1) {
            const questionElementSubmitButton = questionElement.getElementsByClassName(
                'form-submit'
            )[0] as HTMLButtonElement
            questionElementSubmitButton.innerText = 'Next'
            questionElementSubmitButton.type = 'button'
            questionElementSubmitButton.addEventListener('click', () => {
                nextQuestion(idx, survey.id)
            })
        }
        questionTab.insertAdjacentElement('beforeend', questionElement)

        multipleQuestionForm.insertAdjacentElement('beforeend', questionTab)
    })

    return multipleQuestionForm
}

const createSingleQuestionSurvey = (posthog: PostHog, survey: Survey, question: SurveyQuestion) => {
    const questionType = question.type
    if (questionType === 'rating') {
        return createRatingsPopup(posthog, survey, question, 0)
    } else if (questionType === 'open' || questionType === 'link') {
        return createOpenTextOrLinkPopup(posthog, survey, question, 0)
    } else if (questionType === 'single_choice' || questionType === 'multiple_choice') {
        return createMultipleChoicePopup(posthog, survey, question, 0)
    }
    return null
}

function getTextColor(el: HTMLElement) {
    const backgroundColor = window.getComputedStyle(el).backgroundColor
    if (backgroundColor === 'rgba(0, 0, 0, 0)') {
        return 'black'
    }
    const colorMatch = backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/)
    if (!colorMatch) return 'black'

    const r = parseInt(colorMatch[1])
    const g = parseInt(colorMatch[2])
    const b = parseInt(colorMatch[3])
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
    return hsp > 127.5 ? 'black' : 'white'
}

function setTextColors(parentEl: any) {
    for (const el of parentEl.querySelectorAll('.auto-text-color')) {
        el.style.color = getTextColor(el)
    }
}

function showQuestion(n: number, surveyId: string) {
    // This function will display the specified tab of the form...
    const tabs = document
        .getElementsByClassName(`PostHogSurvey${surveyId}`)[0]
        ?.shadowRoot?.querySelectorAll('.tab') as NodeListOf<HTMLElement>
    tabs[n].style.display = 'block'
}

function nextQuestion(currentQuestionIdx: number, surveyId: string) {
    // figure out which tab to display
    const tabs = document
        .getElementsByClassName(`PostHogSurvey${surveyId}`)[0]
        ?.shadowRoot?.querySelectorAll('.tab') as NodeListOf<HTMLElement>

    tabs[currentQuestionIdx].style.display = 'none'
    showQuestion(currentQuestionIdx + 1, surveyId)
}

export function generateSurveys(posthog: PostHog) {
    callSurveys(posthog, true)

    let currentUrl = location.href
    if (location.href) {
        setInterval(() => {
            if (location.href !== currentUrl) {
                currentUrl = location.href
                callSurveys(posthog, false)
            }
        }, 1500)
    }
}
