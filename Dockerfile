FROM ubuntu:22.04

WORKDIR /app/install/

# Install all OS dependencies for fully functional notebook server
RUN DEBIAN_FRONTEND=noninteractive apt update && apt install -y --no-install-recommends \
    # Common useful utilities
    npm \
    python3-pip \
    build-essential \
    wget \
    # Enable clipboard on Linux host systems
    xclip && \
    apt clean && rm -rf /var/lib/apt/lists/* \
    ca-certificates \
    software-properties-common \
    apt-transport-https     

RUN apt-get update && apt-get install -y curl gnupg lsb-release


RUN pip install \
    numpy \
    pandas \
    scipy \
    seaborn \
    scikit-learn \
    yfinance \
    statsmodels \
    plotly \
    dash \
    matplotlib \
    jupyterlab==3.6.4 \
    jupytext \
    jupyter-packaging \
    geopandas \
    langchain \
    milvus

RUN npm cache clean -f
RUN npm install -g n
RUN n stable

RUN npm install -g typescript@4.1.3

# Add Tini. Tini operates as a process subreaper for jupyter. This prevents kernel crashes.
ADD https://github.com/krallin/tini/releases/download/v0.19.0/tini /usr/bin/tini
RUN chmod +x /usr/bin/tini

RUN npm install -g yarn@1.22.19
RUN jupyter labextension install jupyter-matplotlib

COPY package.json .
COPY lerna.json .
COPY requirements.txt .

RUN yarn install --cwd /app/install/
RUN pip install -r requirements.txt

WORKDIR /app/install/jupyter-pilot-backend/
COPY jupyter-pilot-backend .
RUN pip install -e .
RUN jupyter serverextension enable --py jupyter-pilot-backend

WORKDIR /app/install/jupyter-pilot-frontend/
COPY jupyter-pilot-frontend .
RUN pip install -e .
RUN jupyter labextension install .
RUN jlpm build

RUN jupyter nbextension install --py jupytext
RUN jupyter nbextension enable --py jupytext
RUN jupyter labextension disable "@jupyterlab/apputils-extension:announcements"

COPY ./jupyter_notebook_config.py /root/.jupyter/

WORKDIR /app/user/
COPY ./tutorial_files/tutorial.ipynb .
COPY ./tutorial_files/eth_price.csv .

ENV PYTHONUNBUFFERED=1


COPY ./terminal/* /app/install/

ENTRYPOINT ["/usr/bin/tini", "--"]
EXPOSE 8888
EXPOSE 8080

CMD ["sh", "-c", "python3 -u /app/install/terminal.py & jupyter lab --port=8888 --no-browser --ip=0.0.0.0 --allow-root"]


