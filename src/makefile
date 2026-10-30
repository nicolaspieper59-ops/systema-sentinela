# Makefile pour Systema Sentinela (SOFA + WASM Kernel)

CC = emcc
CFLAGS = -O3 -Wall
TARGET = ../wasm_astronomie.js

# Inclusion de tous les fichiers .c (SOFA) et du wrapper C++
SRCS_C = $(wildcard *.c)
SRCS_CPP = astro_engine.cpp

EXPORTS = "['_calculerParametresSiderauxEtSolaires','_calculerDepuisECEF','_malloc','_free']"

all: $(TARGET)

$(TARGET): $(SRCS_C) $(SRCS_CPP)
	$(CC) $(CFLAGS) $(SRCS_CPP) $(SRCS_C) -s WASM=1 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s EXPORTED_FUNCTIONS=$(EXPORTS) \
		-s EXPORTED_RUNTIME_METHODS="['HEAPF64','HEAP32']" \
		-o $(TARGET)

clean:
	rm -f $(TARGET) ../wasm_astronomie.wasm
