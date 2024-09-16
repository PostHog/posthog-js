import { Component, NgZone } from '@angular/core'
import { RouterOutlet } from '@angular/router'

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [RouterOutlet],
    templateUrl: './app.component.html',
    styleUrl: './app.component.css',
})
export class AppComponent {
    title = 'angular-with-zones'

    constructor(private ngZone: NgZone) {}

    makeFetchGet() {
        this.ngZone.run(() => {
            fetch('https://jsonplaceholder.typicode.com/todos/1')
                .then((response) => response.json())
                .then((data) => {
                    // Do something with the data inside Angular's zone
                    this.ngZone.run(() => {
                        console.log('Fetch Response:', data)
                        // You can update any Angular component state here
                    })
                })
                .catch((error) => {
                    // Handle any errors
                    this.ngZone.run(() => {
                        console.error('Fetch Error:', error)
                    })
                })
        })
    }

    makeFetchPost() {
        this.ngZone.run(() => {
            fetch('https://jsonplaceholder.typicode.com/todos/1', { method: 'POST', body: 'i am a post body' })
                .then((response) => response.json())
                .then((data) => {
                    // Do something with the data inside Angular's zone
                    this.ngZone.run(() => {
                        console.log('Fetch Response:', data)
                        // You can update any Angular component state here
                    })
                })
                .catch((error) => {
                    // Handle any errors
                    this.ngZone.run(() => {
                        console.error('Fetch Error:', error)
                    })
                })
        })
    }

    // Method to make an XHR request
    makeXhrGet() {
        this.ngZone.run(() => {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', 'https://jsonplaceholder.typicode.com/todos/1', true)
            xhr.onreadystatechange = () => {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText)
                        this.ngZone.run(() => {
                            console.log('XHR Response:', data)
                        })
                    } else {
                        this.ngZone.run(() => {
                            console.error('XHR Error:', xhr.status)
                        })
                    }
                }
            }
            xhr.send()
        })
    }

    makeXhrPost() {
        this.ngZone.run(() => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', 'https://jsonplaceholder.typicode.com/todos/1', true)
            xhr.onreadystatechange = () => {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText)
                        this.ngZone.run(() => {
                            console.log('XHR Response:', data)
                        })
                    } else {
                        this.ngZone.run(() => {
                            console.error('XHR Error:', xhr.status)
                        })
                    }
                }
            }
            xhr.send()
        })
    }
}
