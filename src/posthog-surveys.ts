import { PostHog } from "./posthog-core";
import { SURVEYS } from "./posthog-persistence";
import { SurveyCallback } from "types";


export class PostHogSurveys {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    getSurveys(callback: SurveyCallback, forceReload: boolean = false) {
        const existingSurveys = this.instance.get_property(SURVEYS)
        if (!existingSurveys || forceReload) {
            this.instance._send_request(
                `${this.instance.get_config('api_host')}/api/surveys/?token=${this.instance.get_config(
                    'token',
                )}`,
                {},
                { method: 'GET' },
                (response) => {
                    const surveys = response.surveys
                    this.instance.persistence.register({ [SURVEYS]: surveys })
                    return callback(surveys)
                }
            )
        } else {
            return callback(existingSurveys)
        }
    }
}