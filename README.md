# labpilot
Copilot for jupyter lab


## How to build and run
Right now the easiest way to use this extension is to build and run the Dockerfile:

    docker build . --tag='labpilot'
    docker run -d --restart=unless-stopped -p 8888:8888 -p 8080:8080 -p 8081:8081 -e JUPYTER_TOKEN=<TOKEN> --name labpilot labpilot